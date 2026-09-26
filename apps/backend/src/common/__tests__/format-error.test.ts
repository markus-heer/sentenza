import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import * as fc from 'fast-check';
import { GraphQLError, type GraphQLFormattedError } from 'graphql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flattenCauses, formatError, getCorrelationId } from '../format-error.js';

const BASE_FORMATTED_ERROR: GraphQLFormattedError = {
  message: 'ursprüngliche graphql-js-Nachricht',
};

describe('formatError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('erhält Nachricht, Code und details eines SentenzaError und ergänzt eine Korrelationskennung', () => {
    const original = new SentenzaError(SentenzaErrorCode.BAD_USER_INPUT, 'Eingabe ungültig.', {
      violations: [{ path: 'input.content', constraints: ['darf nicht leer sein'] }],
    });

    const result = formatError(BASE_FORMATTED_ERROR, original);

    expect(result.message).toBe('Eingabe ungültig.');
    expect(result.extensions?.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(result.extensions?.violations).toEqual(original.details?.violations);
    expect(typeof result.extensions?.correlationId).toBe('string');
    expect((result.extensions?.correlationId as string).length).toBeGreaterThan(0);
  });

  it('erhält Nachricht und Code eines SentenzaError auch im GraphQLError-Umschlag von graphql-js', () => {
    // Die Form, in der Apollo `formatError` tatsächlich aufruft: graphql-js
    // wickelt jeden in einem Feld geworfenen Fehler ein und hängt das Original
    // an `originalError`. Genau so kommt die Ablehnung eines Guards an
    // (Requirement 2.11).
    const original = new SentenzaError(
      SentenzaErrorCode.UNAUTHENTICATED,
      'Für diese Operation ist eine Anmeldung erforderlich.',
    );
    const wrapped = new GraphQLError(original.message, {
      path: ['submitBusuuPayload'],
      originalError: original,
    });

    const result = formatError(BASE_FORMATTED_ERROR, wrapped);

    expect(result.extensions?.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(result.message).toBe('Für diese Operation ist eine Anmeldung erforderlich.');
  });

  it('verwendet die in details.correlationId enthaltene Kennung eines SentenzaError statt eine neue zu erzeugen', () => {
    const original = new SentenzaError(SentenzaErrorCode.INTERNAL_SERVER_ERROR, 'Fehler.', {
      correlationId: 'fixed-correlation-id',
    });

    const result = formatError(BASE_FORMATTED_ERROR, original);

    expect(result.extensions?.correlationId).toBe('fixed-correlation-id');
  });

  it('bildet jeden Nicht-SentenzaError auf INTERNAL_SERVER_ERROR ab, ohne Details des Originalfehlers preiszugeben', () => {
    const secretDbDetail = 'postgresql://sentenza:s3cr3t-pw@db.internal.example:5432/sentenza';
    const original = new Error(`connection failed: ${secretDbDetail}`);
    original.stack = `Error: connection failed\n    at /very/secret/file/path/db.ts:42:5`;

    const result = formatError(BASE_FORMATTED_ERROR, original);

    expect(result.extensions?.code).toBe(SentenzaErrorCode.INTERNAL_SERVER_ERROR);
    expect(result.message).not.toContain(secretDbDetail);
    expect(result.message).not.toContain(original.stack ?? '');
    expect(JSON.stringify(result)).not.toContain(secretDbDetail);
    expect(JSON.stringify(result)).not.toContain('/very/secret/file/path');
    expect(typeof result.extensions?.correlationId).toBe('string');
  });

  it('gibt niemals ein stacktrace-Feld im Ergebnis zurück', () => {
    const original = new Error('irrelevant');

    const result = formatError(BASE_FORMATTED_ERROR, original);

    expect(result).not.toHaveProperty('stacktrace');
    expect(result.extensions).not.toHaveProperty('stacktrace');
  });

  it('protokolliert eine Nicht-SentenzaError-Ursache intern über console.error mit Korrelationskennung', () => {
    const original = new Error('interner Fehler');

    formatError(BASE_FORMATTED_ERROR, original);

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = consoleErrorSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(loggedPayload.component).toBe('apollo-error-formatter');
    expect(typeof loggedPayload.correlationId).toBe('string');
  });
});

describe('getCorrelationId', () => {
  it('liefert undefined, wenn kein details.correlationId vorhanden ist', () => {
    expect(getCorrelationId(new Error('kein SentenzaError'))).toBeUndefined();
    expect(
      getCorrelationId(new SentenzaError(SentenzaErrorCode.INTERNAL_SERVER_ERROR, 'x')),
    ).toBeUndefined();
    expect(getCorrelationId(null)).toBeUndefined();
    expect(getCorrelationId('kein Objekt')).toBeUndefined();
  });

  it('liefert die Kennung aus details.correlationId, wenn vorhanden', () => {
    const error = new SentenzaError(SentenzaErrorCode.INTERNAL_SERVER_ERROR, 'x', {
      correlationId: 'abc-123',
    });
    expect(getCorrelationId(error)).toBe('abc-123');
  });
});

describe('flattenCauses', () => {
  it('gibt genau den Fehler selbst zurück, wenn er keine .cause hat', () => {
    expect(flattenCauses(new Error('ohne Ursache'))).toEqual([
      { name: 'Error', message: 'ohne Ursache' },
    ]);
  });

  it('läuft die .cause-Kette einschließlich des obersten Fehlers ab und schließt niemals .stack ein', () => {
    const root = new Error('Wurzelursache');
    const middle = new Error('mittlere Ursache', { cause: root });
    const top = new Error('oberste Ursache', { cause: middle });

    const result = flattenCauses(top);

    expect(result).toEqual([
      { name: 'Error', message: 'oberste Ursache' },
      { name: 'Error', message: 'mittlere Ursache' },
      { name: 'Error', message: 'Wurzelursache' },
    ]);
    for (const entry of result) {
      expect(entry).not.toHaveProperty('stack');
    }
  });

  it('gibt eine leere Liste für einen Nicht-Error-Wert zurück', () => {
    expect(flattenCauses('kein Error')).toEqual([]);
    expect(flattenCauses(undefined)).toEqual([]);
  });
});
/**
 * Feature: backend-busuu-ingestion, Property 35: Jede Fehlerantwort trägt
 * genau einen Code und keine internen Details.
 *
 * **Validates: Requirements 9.1, 9.3**
 *
 * Geprüft wird `formatError` als reine Funktion über einer breiten Menge
 * erzeugter Fehlerursachen: `SentenzaError` mit jedem Wert der geteilten
 * Enumeration, gewöhnliche Fehler, Fehler von graphql-js, Prisma-artige
 * Fehler mit eigenem, enumfremdem `code`, Ursachenketten sowie
 * Nicht-Error-Werte. Jede Ursache trägt erzeugte Marker für die vier laut
 * Requirement 9.3 verbotenen Inhalte — Aufrufstapel, Datenbankmeldung,
 * Dateipfad, Hostname —, deren Abwesenheit in der Antwort geprüft wird.
 */

/** Die geteilte Enumeration ist die einzige zulässige Quelle für Fehlercodes (Requirement 9.1). */
const ERROR_CODES: readonly string[] = Object.values(SentenzaErrorCode);

/**
 * Interne Details einer erzeugten Fehlerursache. `markers` enthält
 * ausschließlich Zeichenketten ohne von JSON maskierte Zeichen, damit die
 * Prüfung „taucht in der Antwort nicht auf“ nicht an der Maskierung
 * vorbeiläuft.
 */
interface InternalDetails {
  readonly message: string;
  readonly stack: string;
  readonly markers: readonly string[];
}

const internalDetailsArb: fc.Arbitrary<InternalDetails> = fc
  .record({
    token: fc.integer({ min: 0x10000000, max: 0x7fffffff }).map((value) => value.toString(16)),
    table: fc.constantFrom('raw_payload', 'grammar_topic', 'user_account'),
    line: fc.integer({ min: 1, max: 9999 }),
  })
  .map(({ token, table, line }) => {
    const filePath = `/Users/sentenza/apps/backend/src/internal-${token}.ts`;
    const hostname = `db-${token}.internal.sentenza.example`;
    const dbMessage = `ERROR 42P01: relation ${table}_${token} does not exist`;
    const frame = `at handler (${filePath}:${line}:5)`;

    return {
      message: `${dbMessage} [Verbindung zu ${hostname}] [${filePath}]`,
      stack: `Error: interner Fehler\n    ${frame}\n    at run (${filePath}:1:1)`,
      markers: [filePath, hostname, dbMessage, frame],
    };
  });

/**
 * Nachrichten, wie sie das Backend selbst an einem `SentenzaError` setzt:
 * fachlich, ohne interne Details. Die Generatoren spiegeln damit den
 * tatsächlichen Eingaberaum — ein `SentenzaError` entsteht ausschließlich an
 * Aufrufstellen des Backends, nie aus Client-Eingaben.
 */
const benignMessageArb = fc.constantFrom(
  'Eingabe verletzt die deklarierte Validierung.',
  'Nicht angemeldet.',
  'E-Mail-Adresse ist nicht freigegeben.',
  'Google-JWKS ist derzeit nicht erreichbar.',
  'Die Verarbeitung ist fehlgeschlagen.',
);

/**
 * `details`-Formen, wie sie im Backend vorkommen: Validierungsverstöße mit
 * Feldpfad (`validation-exception-factory.ts`), Ingestion-Kontext und eine
 * bereits vergebene Korrelationskennung. Bewusst ohne einen Schlüssel
 * `code`: `details` wird ausschließlich vom Backend gesetzt, und keine
 * Aufrufstelle vergibt darin einen zweiten Fehlercode.
 */
const detailsArb: fc.Arbitrary<Record<string, unknown> | undefined> = fc.option(
  fc.oneof(
    fc.record({
      violations: fc.array(
        fc.record({
          path: fc.constantFrom('input.content', 'input.payloadKind', 'input.items.0.name'),
          constraints: fc.array(
            fc.constantFrom('darf nicht leer sein', 'muss eine Zeichenkette sein'),
            { minLength: 1, maxLength: 2 },
          ),
        }),
        { minLength: 1, maxLength: 3 },
      ),
    }),
    fc.record({
      rawPayloadId: fc.uuid(),
      step: fc.constantFrom('PERSIST_RAW', 'NORMALIZE', 'UPDATE_STATE'),
    }),
    fc.record({ correlationId: fc.uuid() }),
  ),
  { nil: undefined },
);

type CauseShape =
  | 'sentenzaError'
  | 'error'
  | 'causeChain'
  | 'graphqlError'
  | 'prismaLike'
  | 'string'
  | 'number'
  | 'nullish'
  | 'plainObject';

const CAUSE_SHAPES: readonly CauseShape[] = [
  'sentenzaError',
  'error',
  'causeChain',
  'graphqlError',
  'prismaLike',
  'string',
  'number',
  'nullish',
  'plainObject',
];

interface Scenario {
  /** Die erzeugte Fehlerursache, so wie Apollo sie als `originalError` übergibt. */
  readonly cause: unknown;
  /** Der von graphql-js vorformatierte Fehler, den Apollo als erstes Argument übergibt. */
  readonly incoming: GraphQLFormattedError;
  /** Wahr genau dann, wenn die Ursache einem Wert der Enumeration zugeordnet ist. */
  readonly mapped: boolean;
  readonly expectedCode: string;
  readonly expectedCorrelationId: string | undefined;
  readonly markers: readonly string[];
}

function buildCauseChain(internal: InternalDetails, depth: number): Error {
  let error = new Error(internal.message);
  error.stack = internal.stack;

  for (let step = 0; step < depth; step += 1) {
    error = new Error(`Verarbeitungsschritt ${step} fehlgeschlagen`, { cause: error });
    error.stack = internal.stack;
  }

  return error;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    internal: internalDetailsArb,
    shape: fc.constantFrom(...CAUSE_SHAPES),
    code: fc.constantFrom(...Object.values(SentenzaErrorCode)),
    message: benignMessageArb,
    details: detailsArb,
    depth: fc.integer({ min: 1, max: 3 }),
    incomingCarriesStacktrace: fc.boolean(),
  })
  .map(({ internal, shape, code, message, details, depth, incomingCarriesStacktrace }) => {
    const incoming: GraphQLFormattedError = incomingCarriesStacktrace
      ? {
          message: 'ursprüngliche graphql-js-Nachricht',
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED', stacktrace: [internal.stack] },
        }
      : { message: 'ursprüngliche graphql-js-Nachricht' };

    const base = { incoming, markers: internal.markers };

    if (shape === 'sentenzaError') {
      const sentenzaError = new SentenzaError(code, message, details);
      sentenzaError.stack = internal.stack;
      sentenzaError.cause = new Error(internal.message);
      const correlationId = details?.correlationId;

      return {
        ...base,
        cause: sentenzaError,
        mapped: true,
        expectedCode: code,
        expectedCorrelationId: typeof correlationId === 'string' ? correlationId : undefined,
      };
    }

    const unmapped = {
      ...base,
      mapped: false,
      expectedCode: SentenzaErrorCode.INTERNAL_SERVER_ERROR as string,
      expectedCorrelationId: undefined,
    };

    switch (shape) {
      case 'error':
        return { ...unmapped, cause: buildCauseChain(internal, 0) };
      case 'causeChain':
        return { ...unmapped, cause: buildCauseChain(internal, depth) };
      case 'graphqlError':
        return { ...unmapped, cause: new GraphQLError(internal.message) };
      case 'prismaLike':
        return {
          ...unmapped,
          cause: Object.assign(new Error(internal.message), {
            name: 'PrismaClientKnownRequestError',
            code: 'P2002',
            meta: { target: [internal.message] },
          }),
        };
      case 'string':
        return { ...unmapped, cause: internal.message };
      case 'number':
        return { ...unmapped, cause: 42 };
      case 'nullish':
        return { ...unmapped, cause: null };
      default:
        return { ...unmapped, cause: { message: internal.message, stack: internal.stack } };
    }
  });

describe('formatError (Property 35)', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('gibt je Fehlerursache genau einen Code der Enumeration, die Korrelationskennung und keine internen Details zurück', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const result = formatError(scenario.incoming, scenario.cause);
        const extensions = result.extensions ?? {};

        // Genau ein Fehlercode aus der geteilten Enumeration: der Schlüssel
        // `code` ist der einzige, dessen Wert ein Enumerationswert ist.
        const codeBearingKeys = Object.entries(extensions)
          .filter(([, value]) => typeof value === 'string' && ERROR_CODES.includes(value))
          .map(([key]) => key);
        expect(codeBearingKeys).toEqual(['code']);

        // Eine Ursache ohne Zuordnung zu einem Enumerationswert ergibt
        // INTERNAL_SERVER_ERROR; eine zugeordnete behält ihren Code.
        expect(extensions.code).toBe(scenario.expectedCode);

        // Die Antwort trägt eine Korrelationskennung; liegt am Fehler bereits
        // eine vor, wird genau diese übernommen.
        const correlationId = extensions.correlationId;
        expect(typeof correlationId).toBe('string');
        expect(correlationId).not.toBe('');
        if (scenario.expectedCorrelationId !== undefined) {
          expect(correlationId).toBe(scenario.expectedCorrelationId);
        }

        // Requirement 9.3 verlangt die Kennung in der Fehlermeldung für die
        // nicht zugeordnete Ursache; die Meldung eines SentenzaError bleibt
        // unverändert und trägt die Kennung in den extensions.
        if (!scenario.mapped) {
          expect(result.message).toContain(correlationId as string);
        }

        // Kein Aufrufstapel, keine Datenbankmeldung, kein Dateipfad, kein
        // Hostname — weder in der Meldung noch in den extensions.
        const serializedExtensions = JSON.stringify(extensions);
        for (const marker of scenario.markers) {
          expect(result.message).not.toContain(marker);
          expect(serializedExtensions).not.toContain(marker);
        }
        expect(result).not.toHaveProperty('stacktrace');
        expect(extensions).not.toHaveProperty('stacktrace');
      }),
      { numRuns: 100 },
    );
  });
});
