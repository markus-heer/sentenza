import { randomUUID } from 'node:crypto';

import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import type { GraphQLFormattedError } from 'graphql';

/** Fester Bezeichner dieser Komponente für interne Protokolleinträge (Requirement 9.3). */
const COMPONENT = 'apollo-error-formatter';

/**
 * Beschreibung einer Stufe der `.cause`-Kette, ausschließlich zur internen
 * Protokollierung bestimmt (design.md, Abschnitt "Apollo-Fehlerformatierer").
 *
 * Enthält bewusst keinen Aufrufstapel: `flattenCauses` liest nur `name` und
 * `message`, nie `.stack`, damit über keinen Umweg ein Aufrufstapel in ein
 * Protokoll oder eine Antwort gelangen kann.
 */
export interface FlattenedCause {
  readonly name: string;
  readonly message: string;
}

/**
 * Läuft die `.cause`-Kette (ES2022 `Error.cause`) eines Fehlers ab und gibt
 * sie als Liste einfacher Beschreibungen zurück, ausschließlich für die
 * interne Protokollierung (design.md, Abschnitt "Apollo-Fehlerformatierer").
 *
 * Nie an den Client gesendet. Enthält weder `.stack` noch andere interne
 * Details über den reinen Namen und die Nachricht hinaus.
 */
export function flattenCauses(error: unknown, maxDepth = 20): FlattenedCause[] {
  const causes: FlattenedCause[] = [];
  let current: unknown = error;
  let depth = 0;

  while (current instanceof Error && depth < maxDepth) {
    causes.push({ name: current.name, message: current.message });
    current = current.cause;
    depth += 1;
  }

  return causes;
}

/** Schmale Sicht auf einen Fehler, der möglicherweise eine Korrelationskennung mitführt. */
interface PossiblyCorrelated {
  readonly details?: Record<string, unknown>;
}

function extractCorrelationId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const details = (value as PossiblyCorrelated).details;
  if (!details || typeof details !== 'object') {
    return undefined;
  }

  const candidate = (details as Record<string, unknown>).correlationId;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

/**
 * Ermittelt die Korrelationskennung eines Fehlers, sofern eine vorliegt.
 *
 * Bislang trägt ausschließlich `SentenzaError.details.correlationId` eine
 * solche Kennung (zum Beispiel Ingestion-Fehler aus Aufgabe 8.x, die
 * `details: { correlationId: ctx.correlationId, ... }` setzen). Gibt es
 * keine, liefert diese Funktion `undefined`, und der Aufrufer erzeugt über
 * `randomUUID()` eine neue Kennung (design.md, Abschnitt
 * "Apollo-Fehlerformatierer").
 */
export function getCorrelationId(originalError: unknown): string | undefined {
  return extractCorrelationId(unwrapOriginalError(originalError));
}

/** Obergrenze der Auswickeltiefe; schützt vor einer Ursachenkette ohne Ende. */
const MAX_UNWRAP_DEPTH = 5;

/**
 * Holt die tatsächlich geworfene Ursache aus dem Fehler, den Apollo übergibt
 * (design.md, Abschnitt "Apollo-Fehlerformatierer").
 *
 * Nötig, weil graphql-js jeden in einem Feld geworfenen Fehler in einen
 * `GraphQLError` einwickelt und das Original an `originalError` hängt. Apollo
 * ruft `formatError` mit diesem Umschlag auf, nicht mit dem Original. Ohne
 * Auswickeln wäre `cause instanceof SentenzaError` nie wahr, und jede fachliche
 * Ablehnung käme als `INTERNAL_SERVER_ERROR` beim Client an — etwa die eines
 * `GqlAuthGuard`, die `UNAUTHENTICATED` tragen muss (Requirement 2.11).
 *
 * Geprüft wird die Form und nicht `instanceof GraphQLError`, obwohl Apollo für
 * diesen Zweck `unwrapResolverError` veröffentlicht: `graphql` liefert sowohl
 * eine CommonJS- als auch eine ES-Modul-Ausgabe, und werden beide im selben
 * Prozess geladen, gibt es zwei verschiedene Klassen `GraphQLError`. Ein
 * `instanceof` gegen die eine erkennt die andere nicht. Das Merkmal `originalError`
 * an einem Fehler ist dagegen unabhängig davon, welche Ausgabe geladen wurde.
 *
 * Die Schleife deckt eine mehrfach eingewickelte Ursache ab. Ein Fehler ohne
 * `originalError` — etwa ein Syntax- oder Validierungsfehler von graphql-js —
 * bleibt unverändert und wird weiterhin zu `INTERNAL_SERVER_ERROR`.
 */
function unwrapOriginalError(originalError: unknown): unknown {
  let current: unknown = originalError;

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    if (!(current instanceof Error)) {
      return current;
    }

    const wrapped = (current as { originalError?: unknown }).originalError;

    if (!(wrapped instanceof Error)) {
      return current;
    }

    current = wrapped;
  }

  return current;
}

/**
 * Apollo-`formatError`-Rückruf (design.md, Abschnitt
 * "Apollo-Fehlerformatierer"; Requirement 9.1, 9.2, 9.3).
 *
 * `SentenzaError` bleibt inhaltlich erhalten: Nachricht, Fehlercode und
 * `details` (zum Beispiel Validierungsverstöße mit Feldpfad, siehe
 * `validation-exception-factory.ts`) wandern unverändert in die Antwort.
 * Jede andere Ursache — auch Fehler von graphql-js selbst (Syntax-,
 * Validierungsfehler) und alles, was aus Prisma, dem Dateisystem oder dem
 * Betriebssystem stammt — wird zu `INTERNAL_SERVER_ERROR`: Die Antwort
 * enthält ausschließlich eine generische Nachricht mit Korrelationskennung
 * und `{ code, correlationId }`; nichts vom Originalfehler (Aufrufstapel,
 * Datenbankmeldung, Dateipfad, Hostname) erreicht den Client. Die interne
 * Ursache wird stattdessen protokolliert (vorerst über `console.error`, bis
 * Aufgabe 4.7 die strukturierte, redigierende Protokollierung liefert).
 */
export function formatError(
  formattedError: GraphQLFormattedError,
  originalError: unknown,
): GraphQLFormattedError {
  // Apollo übergibt den `GraphQLError`-Umschlag; gemeint ist die Ursache darin.
  const cause = unwrapOriginalError(originalError);
  const correlationId = getCorrelationId(cause) ?? randomUUID();

  if (cause instanceof SentenzaError) {
    return {
      ...formattedError,
      message: cause.message,
      extensions: {
        code: cause.code,
        correlationId,
        ...cause.details,
      },
    };
  }

  // Platzhalter-Protokollierung (Aufgabe 4.3-Präzedenzfall: plain console
  // logging, bis die strukturierte Protokollierung in Aufgabe 4.7 entsteht).
  // Form bewusst kompatibel zum künftigen Logger gehalten.
  console.error({
    correlationId,
    component: COMPONENT,
    causeChain: flattenCauses(cause),
  });

  return {
    message: `Interner Fehler. Korrelationskennung: ${correlationId}`,
    extensions: {
      code: SentenzaErrorCode.INTERNAL_SERVER_ERROR,
      correlationId,
    },
  };
}
