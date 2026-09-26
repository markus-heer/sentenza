import { createHash } from 'node:crypto';

import {
  PayloadKind,
  ProcessingState,
  SentenzaError,
  SentenzaErrorCode,
  SubmissionSource,
} from '@sentenza/domain';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import type { ValidationViolation } from '../common/validation-exception-factory.js';
import type { SentenzaConfig } from '../config/configuration.js';
import type { RawPayload } from '../prisma/prisma.types.js';

/**
 * Feldpfade innerhalb der Mutationseingabe `SubmitBusuuPayloadInput`
 * (Requirement 9.2: jedes verletzte Eingabefeld wird mit seinem Pfad
 * benannt). Dieselbe Form wie die Pfade aus
 * `common/validation-exception-factory.ts`, damit ein Client Verstöße der
 * deklarierten GraphQL-Validierung und Verstöße dieser Prüfung gleich
 * auswerten kann.
 */
const PAYLOAD_KIND_PATH = 'input.payloadKind';
const CONTENT_PATH = 'input.content';

/** Verarbeitungsschritt in Protokolleinträgen dieses Moduls (Requirement 9.4). */
const STEP_CREATE = 'ingestion.rawPayload.create';

/** Die unterstützten Payload-Arten, in der Reihenfolge der Enumeration. */
const SUPPORTED_PAYLOAD_KINDS = Object.values(PayloadKind);

/**
 * Obergrenze für die Wiedergabe eines beanstandeten Eingabewerts in der
 * Fehlermeldung. Requirement 3.11 verlangt, den beanstandeten Wert zu
 * benennen; eine unbegrenzte Wiedergabe würde bei einer sehr langen
 * Payload-Art die Antwort aufblähen und im Grenzfall den abgelehnten Inhalt
 * selbst spiegeln.
 */
const MAX_REPORTED_VALUE_LENGTH = 60;

/**
 * Der Verarbeitungszustand, den T1 am neuen Eintrag ablegt.
 *
 * `ProcessingState` kennt bewusst keinen Zwischenzustand (design.md,
 * Abschnitt "Data Models"): Requirement 3.9 nennt genau die drei Werte
 * `VERARBEITET`, `TEILWEISE_VERARBEITET` und `FEHLGESCHLAGEN`. Ein Eintrag
 * muss beim Einfügen dennoch einen davon tragen, und das darf nicht
 * `VERARBEITET` sein: Bricht der Vorgang zwischen T1 und T3 ab — etwa weil
 * die Datenbank wegfällt —, bliebe sonst ein nie normalisierter Payload als
 * verarbeitet stehen. `FEHLGESCHLAGEN` ohne `processedAt` und ohne
 * `errorMessage` ist genau die Kombination, an der ein nicht
 * fortgeschriebener Eintrag erkennbar ist (design.md, Abschnitt
 * "Transaktionsgrenzen").
 */
export const RAW_PAYLOAD_INITIAL_PROCESSING_STATE = ProcessingState.FEHLGESCHLAGEN;

/**
 * Eine Einreichung, so wie sie ungeprüft an der Schnittstelle ankommt.
 *
 * Beide Felder sind absichtlich `unknown` und nicht `PayloadKind` bzw.
 * `string`: Requirement 3.11 verlangt eine Prüfung der Payload-Art gegen die
 * Enumeration, und eine Prüfung, deren Eingabe der Typ schon als gültig
 * behauptet, wäre keine. Die getippte Mutationseingabe aus Aufgabe 8.3
 * erfüllt diese Form ohne Umweg.
 */
export interface UncheckedSubmission {
  readonly payloadKind: unknown;
  readonly content: unknown;
}

/**
 * Eine geprüfte Einreichung: Payload-Art aus der Enumeration, nicht-leerer
 * Inhalt und die beiden daraus abgeleiteten Kennwerte.
 *
 * `contentBytes` und `contentHash` entstehen hier und nicht an der
 * Aufrufstelle, damit sie nicht auseinanderlaufen können: Die Größe ist genau
 * die, gegen die geprüft wurde, und der Hash ist über denselben unveränderten
 * Inhalt gebildet, der abgelegt wird (Requirement 3.3). Zugleich sind es die
 * beiden einzigen Angaben, die anstelle des Inhalts protokolliert werden
 * dürfen (Requirement 9.5).
 */
export interface AcceptedSubmission {
  readonly payloadKind: PayloadKind;
  readonly content: string;
  readonly contentBytes: number;
  readonly contentHash: string;
}

/**
 * Die Daten eines Einfügevorgangs von T1 (design.md, Abschnitt
 * "Transaktionsgrenzen", Schritt 3).
 *
 * Die Aufzählungsfelder tragen die von Prisma erzeugten Typen und nicht die
 * Enumerationen aus `@sentenza/domain`. Der Grund ist die Zuweisungsrichtung:
 * Ein Wert einer Zeichenketten-Enumeration ist der entsprechenden
 * Literalvereinigung zuweisbar, umgekehrt nicht. So bleibt `PrismaService`
 * eine gültige Umsetzung von `RawPayloadStore`, und die Domänenenumerationen
 * bleiben die Sprache der öffentlichen Schnittstelle dieses Moduls.
 */
export interface RawPayloadInsertData {
  userAccountId: string;
  payloadKind: RawPayload['payloadKind'];
  submissionSource: RawPayload['submissionSource'];
  submittedAt: Date;
  contentBytes: number;
  contentHash: string;
  content: string;
  correlationId: string;
  processingState: RawPayload['processingState'];
}

/**
 * Der abgelegte Eintrag, soweit ihn eine Aufrufstelle braucht.
 *
 * Ausdrücklich ohne `content`: Den Inhalt kennt die Aufrufstelle ohnehin, sie
 * hat ihn eingereicht. Ihn hier zurückzugeben, würde ihn durch den ganzen
 * Ablauf und in jedes versehentlich mitprotokollierte Objekt tragen
 * (Requirement 9.5). Der Abruf des Inhalts ist eine eigene Operation
 * (Requirement 3.13, Aufgabe 8.4).
 */
export type StoredRawPayload = Pick<
  RawPayload,
  | 'id'
  | 'userAccountId'
  | 'payloadKind'
  | 'submissionSource'
  | 'submittedAt'
  | 'contentBytes'
  | 'contentHash'
  | 'correlationId'
  | 'processingState'
>;

/**
 * Die einzige Fähigkeit, die T1 vom Prisma-Client braucht.
 *
 * Bewusst so schmal geschnitten wie `AuthStore` in `auth/auth.service.ts` und
 * `DatabasePingClient` in `health/probe-database.ts`: Die Prüfungen und der
 * Zuschnitt des Einfügevorgangs sind damit ohne laufende Nest-Anwendung und
 * ohne Datenbank prüfbar. `PrismaService` erfüllt diese Form; dass er es tut,
 * bestätigt der Type-Check an der Erzeugungsstelle im Modul.
 */
export interface RawPayloadCreateStore {
  create(args: { data: RawPayloadInsertData }): Promise<StoredRawPayload>;
}

export interface RawPayloadStore {
  rawPayload: RawPayloadCreateStore;
}

/** Die Teilmenge der Konfiguration, die dieses Repository selbst auswertet. */
export type RawPayloadRepositorySettings = Pick<SentenzaConfig['ingestion'], 'maxPayloadBytes'>;

/** Argumente einer Ablage (T1). */
export interface CreateRawPayloadArgs {
  /** Konto des angemeldeten Benutzers; jeder Eintrag gehört genau einem Konto. */
  userAccountId: string;
  /** Die ungeprüfte Einreichung; die Prüfung läuft vor dem Einfügen. */
  input: UncheckedSubmission;
  /** Korrelationskennung des Ingestion_Vorgangs (Requirement 9.10). */
  correlationId: string;
  /**
   * Zeitpunkt der Einreichung (Requirement 3.3). Ohne Angabe die aktuelle
   * Zeit; ausdrücklich angebbar, damit die Normalisierung denselben Zeitpunkt
   * verwenden kann, den der Eintrag trägt (Requirement 5.3).
   */
  submittedAt?: Date;
}

/**
 * Ergebnis einer Ablage: der Eintrag und die geprüfte Einreichung.
 *
 * Die geprüfte Einreichung wird mitgegeben, weil der weitere Ablauf sie
 * braucht: Die Normalisierung (T2) arbeitet auf dem Inhalt, und die
 * Protokollierung darf ausschließlich `contentHash` und `contentBytes`
 * nennen (Requirement 9.5). Beides erneut zu berechnen wäre nicht nur
 * doppelte Arbeit, sondern eine zweite Wahrheit.
 */
export interface CreatedRawPayload {
  readonly entry: StoredRawPayload;
  readonly submission: AcceptedSubmission;
}

/** Ergebnis der Prüfung: entweder eine geprüfte Einreichung oder Verstöße. */
type ValidationOutcome =
  | { readonly accepted: AcceptedSubmission; readonly violations?: undefined }
  | { readonly accepted?: undefined; readonly violations: readonly ValidationViolation[] };

/** SHA-256 in Hex über den unveränderten Inhalt (Requirement 3.3). */
function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Wiedergabe eines beanstandeten Eingabewerts für die Fehlermeldung
 * (Requirement 3.11), gekürzt und ohne Anspruch auf Serialisierbarkeit des
 * Werts. Eine Zeichenkette erscheint in Anführungszeichen, jeder andere Wert
 * über seinen Typ — `null`, eine Zahl oder ein Objekt als Payload-Art ist
 * kein Wert, den eine Meldung wiedergeben müsste.
 */
function describeValue(value: unknown): string {
  if (typeof value !== 'string') {
    return value === null ? 'null' : `vom Typ ${typeof value}`;
  }

  const shortened =
    value.length > MAX_REPORTED_VALUE_LENGTH
      ? `${value.slice(0, MAX_REPORTED_VALUE_LENGTH)}…`
      : value;

  return `"${shortened}"`;
}

/** Die Payload-Art, sofern sie ein Wert der Enumeration ist (Requirement 3.11). */
function toPayloadKind(value: unknown): PayloadKind | undefined {
  return SUPPORTED_PAYLOAD_KINDS.find((kind) => kind === value);
}

/**
 * Prüft eine Einreichung, ohne zu werfen (Requirement 3.8, 3.11).
 *
 * Alle Verstöße werden gesammelt und nicht beim ersten abgebrochen:
 * Requirement 9.2 verlangt, *jedes* verletzte Eingabefeld zu benennen, und
 * wer eine falsche Payload-Art mit einem zu großen Inhalt einreicht, soll
 * nicht zweimal einreichen müssen, um beides zu erfahren.
 *
 * Zur Größe: Maßstab ist `Buffer.byteLength(content, 'utf8')` und nicht
 * `content.length`. Die Zeichenlänge einer Zeichenkette sagt nichts über den
 * Platz, den ihre UTF-8-Form braucht — ein Katalog mit Akzenten und
 * Anführungszeichen belegt deutlich mehr Byte als Zeichen.
 */
function validateSubmission(
  input: UncheckedSubmission,
  maxPayloadBytes: number,
): ValidationOutcome {
  const violations: ValidationViolation[] = [];
  const payloadKind = toPayloadKind(input.payloadKind);

  if (payloadKind === undefined) {
    violations.push({
      path: PAYLOAD_KIND_PATH,
      constraints: [
        `Die Payload-Art ${describeValue(input.payloadKind)} gehört nicht zu den ` +
          `unterstützten Payload-Arten (${SUPPORTED_PAYLOAD_KINDS.join(', ')}).`,
      ],
    });
  }

  const content = input.content;
  let contentBytes = 0;

  if (typeof content !== 'string') {
    violations.push({
      path: CONTENT_PATH,
      constraints: [`Der Payload-Inhalt ist ${describeValue(content)} und keine Zeichenkette.`],
    });
  } else if (content.length === 0) {
    violations.push({
      path: CONTENT_PATH,
      constraints: ['Der Payload-Inhalt ist leer.'],
    });
  } else {
    contentBytes = Buffer.byteLength(content, 'utf8');

    if (contentBytes > maxPayloadBytes) {
      // Der beanstandete Wert ist hier die Größe, nicht der Inhalt: Der
      // Inhalt selbst gehört in keine Fehlermeldung und in keinen
      // Protokolleintrag (Requirement 9.5).
      violations.push({
        path: CONTENT_PATH,
        constraints: [
          `Der Payload-Inhalt ist mit ${contentBytes} Byte größer als die zulässigen ` +
            `${maxPayloadBytes} Byte.`,
        ],
      });
    }
  }

  // Die beiden zusätzlichen Vergleiche sind fachlich von `violations.length`
  // gedeckt und stehen allein für den Type-Check da: Er kann aus der Länge der
  // Liste nicht ableiten, dass Payload-Art und Inhalt geprüft sind.
  if (violations.length > 0 || payloadKind === undefined || typeof content !== 'string') {
    return { violations };
  }

  return {
    accepted: { payloadKind, content, contentBytes, contentHash: sha256Hex(content) },
  };
}

/** Der Fehler, mit dem eine beanstandete Einreichung abgelehnt wird. */
function rejectSubmission(violations: readonly ValidationViolation[]): SentenzaError {
  const message = violations.flatMap((violation) => violation.constraints).join(' ');

  return new SentenzaError(
    SentenzaErrorCode.BAD_USER_INPUT,
    `Die Einreichung wurde abgelehnt. ${message}`,
    { violations },
  );
}

/**
 * Prüft eine Einreichung und liefert ihre geprüfte Form (Requirement 3.8,
 * 3.11).
 *
 * Wirft `SentenzaError` mit `BAD_USER_INPUT`, wenn die Payload-Art nicht zur
 * Enumeration gehört, der Inhalt leer ist oder seine UTF-8-Größe die
 * konfigurierte Grenze überschreitet. Die Nachricht benennt den beanstandeten
 * Eingabewert, `details.violations` zusätzlich seinen Pfad innerhalb der
 * Eingabe (Requirement 9.2).
 *
 * Eigenständig exportiert und nicht bloß eine Zeile in `create`, obwohl
 * `create` sie selbst aufruft: Die Prüfung ist eine Entscheidung über ihren
 * Eingaben und damit ohne Datenbank prüfbar, und eine vorgelagerte Stelle
 * kann eine Einreichung so ablehnen, bevor irgendein Mitspieler des
 * Ingestion_Vorgangs überhaupt angesprochen wird. Die Zusage „kein Eintrag im
 * Raw_Payload_Store" (Requirement 3.8, 3.11) kann diese Funktion selbst nicht
 * brechen: Sie kennt Prisma nicht.
 */
export function assertSubmissionAcceptable(
  input: UncheckedSubmission,
  maxPayloadBytes: number,
): AcceptedSubmission {
  const outcome = validateSubmission(input, maxPayloadBytes);

  if (outcome.accepted === undefined) {
    throw rejectSubmission(outcome.violations);
  }

  return outcome.accepted;
}

/**
 * Raw_Payload_Store: die Ablage roher Payloads (Requirement 3.2, 3.3, 3.7,
 * 3.8, 3.11; design.md, Abschnitt "Ingestion-Modul").
 *
 * Das Repository ist die einzige Stelle, die Einträge anlegt, und es prüft
 * jede Einreichung, bevor es einfügt. Diese Reihenfolge steht hier und nicht
 * in der Aufrufstelle, weil die Zusage genau das verlangt: Ein Verstoß darf
 * keinen Eintrag hinterlassen (Requirement 3.8, 3.11). Läge die Prüfung im
 * Service, wäre sie eine Gewohnheit; hier ist sie eine Eigenschaft der
 * Ablage — auch eine künftige zweite Aufrufstelle kann sie nicht umgehen.
 *
 * Mehrfache Einreichung desselben Inhalts ist ausdrücklich erlaubt: Jeder
 * Aufruf von `create` legt einen eigenen Eintrag mit eigener Kennung an, und
 * `contentHash` ist in `schema.prisma` indiziert, aber nicht eindeutig
 * (Requirement 3.7). Abgelegte Inhalte werden nie verändert, gekürzt oder
 * gelöscht (Requirement 3.12); dieses Repository kennt dafür schlicht kein
 * Verfahren.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `AuthService` wird die Klasse
 * über eine Factory im Modul erzeugt, weil ihre Mitspieler Schnittstellen
 * sind, die Nest zur Laufzeit nicht auflösen könnte.
 */
export class RawPayloadRepository {
  constructor(
    private readonly store: RawPayloadStore,
    private readonly settings: RawPayloadRepositorySettings,
    private readonly logger: SentenzaLogger = createLogger({ component: 'ingestion' }),
    /**
     * Zeitquelle für `submittedAt`. Konstruktorargument mit Vorgabewert wie in
     * `AuthService`: Ein Test kann damit einen festen Einreichungszeitpunkt
     * setzen, ohne die Systemuhr zu verstellen.
     */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Legt einen Payload zeichengenau ab (T1; Requirement 3.2, 3.3).
   *
   * Die Prüfung läuft vor dem Einfügen; ein Verstoß ergibt `BAD_USER_INPUT`
   * und hinterlässt keinen Eintrag (Requirement 3.8, 3.11). Danach folgt
   * genau ein `INSERT` mit dem unveränderten Inhalt, dem Zeitpunkt der
   * Einreichung, dem Konto, der Payload-Art, der Quelle
   * `SENTENZA_EXTENSION`, der Größe in Byte, dem Inhalts-Hash und der
   * Korrelationskennung (Requirement 3.3).
   *
   * Der Aufruf ist die erste der drei Transaktionen des Ablaufs und
   * ausdrücklich für sich festgeschrieben: Erst nach seiner Rückkehr beginnt
   * die Normalisierung (Requirement 3.2). Ein eigener `$transaction`-Rahmen
   * ist dafür nicht nötig — ein einzelner Prisma-Schreibvorgang ist für sich
   * eine Transaktion.
   */
  async create(args: CreateRawPayloadArgs): Promise<CreatedRawPayload> {
    const { userAccountId, input, correlationId } = args;
    const outcome = validateSubmission(input, this.settings.maxPayloadBytes);

    if (outcome.accepted === undefined) {
      // Der Protokolleintrag benennt den Schritt und die Korrelationskennung
      // (Requirement 9.4, 9.10) sowie die verletzten Pfade — nicht den
      // beanstandeten Inhalt (Requirement 9.5).
      this.logger.warn('Einreichung abgelehnt', {
        step: STEP_CREATE,
        correlationId,
        userAccountId,
        reason: 'bad-user-input',
        violationPaths: outcome.violations.map((violation) => violation.path),
      });

      throw rejectSubmission(outcome.violations);
    }

    const submission = outcome.accepted;
    const submittedAt = args.submittedAt ?? this.now();

    const entry = await this.store.rawPayload.create({
      data: {
        userAccountId,
        payloadKind: submission.payloadKind,
        submissionSource: SubmissionSource.SENTENZA_EXTENSION,
        submittedAt,
        contentBytes: submission.contentBytes,
        contentHash: submission.contentHash,
        // Zeichengenau und ohne jede Umformung: kein `JSON.parse`, kein
        // `trim`, keine Neusortierung (Requirement 3.2). Die Spalte ist
        // `String @db.Text` und ausdrücklich nicht `Json`.
        content: submission.content,
        correlationId,
        processingState: RAW_PAYLOAD_INITIAL_PROCESSING_STATE,
      },
    });

    this.logger.info('Roher Payload abgelegt', {
      step: STEP_CREATE,
      correlationId,
      rawPayloadId: entry.id,
      userAccountId,
      payloadKind: submission.payloadKind,
      contentBytes: submission.contentBytes,
      contentHash: submission.contentHash,
    });

    return { entry, submission };
  }
}
