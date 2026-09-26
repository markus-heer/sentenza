import { createHash } from 'node:crypto';

import { PayloadKind, SentenzaError, SentenzaErrorCode, SubmissionSource } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import { createLogger, type SentenzaLogger } from '../../common/logger.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertSubmissionAcceptable,
  type CreateRawPayloadArgs,
  RAW_PAYLOAD_INITIAL_PROCESSING_STATE,
  type RawPayloadInsertData,
  RawPayloadRepository,
  type RawPayloadRepositorySettings,
  type RawPayloadStore,
  type StoredRawPayload,
} from '../raw-payload.repository.js';

/**
 * Eingabe- und Größenprüfung sowie die Ablage roher Payloads (Aufgabe 8.1;
 * Requirement 3.1, 3.2, 3.3, 3.8, 3.11).
 *
 * Kein Nest-Abhängigkeitsbaum und keine Datenbank: Die Klasse wird von Hand
 * instanziiert, Prisma ist eine Attrappe, die ihre Einfügevorgänge
 * mitschreibt. Genau das ist hier die stärkere Prüfung — die Zusage lautet,
 * dass ein Verstoß *keinen* Schreibvorgang auslöst, und eine Attrappe kann
 * belegen, dass überhaupt keiner ankam. Der zeichengenaue Round-Trip durch
 * die Datenbank ist Property 7 (Aufgabe 8.5), die Größengrenze gegen den
 * gesamten Zeichenkettenraum Property 10 (Aufgabe 8.7).
 */

const MAX_PAYLOAD_BYTES = 1_024;
const SETTINGS: RawPayloadRepositorySettings = { maxPayloadBytes: MAX_PAYLOAD_BYTES };

const USER_ACCOUNT_ID = 'konto-1';
const CORRELATION_ID = 'korrelation-1';
const SUBMITTED_AT = new Date('2026-03-01T10:20:30.000Z');

/**
 * Ein Inhalt, dessen Form eine Umformung sofort verriete: uneinheitliche
 * Einrückung, Felder in unalphabetischer Reihenfolge, ein leeres Feld, ein
 * mehrbyte-Zeichen und ein abschließender Zeilenumbruch (Requirement 3.2).
 */
const CONTENT = '{ "b": 1,\n  "a": "ñ",   "c": "" }\n';

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** Ein mitgeschriebener Einfügevorgang, wie ihn `RawPayloadStore` entgegennimmt. */
type CreateCall = { data: RawPayloadInsertData };

interface StoreDouble extends RawPayloadStore {
  readonly createCalls: CreateCall[];
}

/**
 * Prisma-Attrappe. `create` verhält sich wie die Datenbank es täte: Es gibt
 * den angelegten Eintrag mit einer eigenen Kennung zurück und übernimmt die
 * übergebenen Werte unverändert. Welche Werte das waren, hält der Test an
 * `createCalls` fest.
 */
function storeDouble(options: { failsWith?: Error } = {}): StoreDouble {
  const createCalls: CreateCall[] = [];

  return {
    createCalls,
    rawPayload: {
      create(args) {
        createCalls.push(args);

        if (options.failsWith) {
          return Promise.reject(options.failsWith);
        }

        const entry: StoredRawPayload = {
          id: `roher-payload-${createCalls.length}`,
          userAccountId: args.data.userAccountId,
          payloadKind: args.data.payloadKind,
          submissionSource: args.data.submissionSource,
          submittedAt: args.data.submittedAt,
          contentBytes: args.data.contentBytes,
          contentHash: args.data.contentHash,
          correlationId: args.data.correlationId,
          processingState: args.data.processingState,
        };

        return Promise.resolve(entry);
      },
    },
  };
}

function loggerCollecting(): { logger: SentenzaLogger; lines: string[] } {
  const lines: string[] = [];

  return {
    logger: createLogger({
      component: 'ingestion',
      level: 'debug',
      sink: (line) => lines.push(line),
    }),
    lines,
  };
}

function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Harness {
  repository: RawPayloadRepository;
  store: StoreDouble;
  lines: string[];
}

function harness(options: { failsWith?: Error } = {}): Harness {
  const store = storeDouble(options);
  const { logger, lines } = loggerCollecting();

  return {
    repository: new RawPayloadRepository(store, SETTINGS, logger, () => SUBMITTED_AT),
    store,
    lines,
  };
}

function args(overrides: Partial<CreateRawPayloadArgs> = {}): CreateRawPayloadArgs {
  return {
    userAccountId: USER_ACCOUNT_ID,
    input: { payloadKind: PayloadKind.CATALOG, content: CONTENT },
    correlationId: CORRELATION_ID,
    ...overrides,
  };
}

/** Der geworfene Fehler, mit der Zusicherung, dass es ein `SentenzaError` ist. */
async function rejection(promise: Promise<unknown>): Promise<SentenzaError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );

  expect(error).toBeInstanceOf(SentenzaError);

  return error as SentenzaError;
}

function violationsOf(error: SentenzaError): { path: string; constraints: string[] }[] {
  return (error.details?.violations ?? []) as { path: string; constraints: string[] }[];
}

describe('assertSubmissionAcceptable', () => {
  it('nimmt eine Einreichung an und liefert Größe und Inhalts-Hash des unveränderten Inhalts', () => {
    const accepted = assertSubmissionAcceptable(
      { payloadKind: PayloadKind.PROGRESS, content: CONTENT },
      MAX_PAYLOAD_BYTES,
    );

    expect(accepted.payloadKind).toBe(PayloadKind.PROGRESS);
    // Requirement 3.2: zeichengenau, keine Umformung.
    expect(accepted.content).toBe(CONTENT);
    // Requirement 3.3: Größe in Byte, nicht in Zeichen. `ñ` belegt zwei Byte,
    // die Zeichenlänge wäre also zu klein.
    expect(accepted.contentBytes).toBe(Buffer.byteLength(CONTENT, 'utf8'));
    expect(accepted.contentBytes).toBeGreaterThan(CONTENT.length);
    expect(accepted.contentHash).toBe(sha256Hex(CONTENT));
  });

  it('lehnt eine unbekannte Payload-Art mit BAD_USER_INPUT ab und benennt den Eingabewert', () => {
    let error: SentenzaError | undefined;

    try {
      assertSubmissionAcceptable({ payloadKind: 'VOKABELN', content: CONTENT }, MAX_PAYLOAD_BYTES);
    } catch (thrown) {
      error = thrown as SentenzaError;
    }

    expect(error).toBeInstanceOf(SentenzaError);
    expect(error?.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    // Requirement 3.11: der beanstandete Eingabewert steht in der Meldung.
    expect(error?.message).toContain('"VOKABELN"');
    // Requirement 9.2: mit Pfad innerhalb der Eingabe.
    expect(violationsOf(error as SentenzaError)).toEqual([
      { path: 'input.payloadKind', constraints: [expect.stringContaining('VOKABELN')] },
    ]);
  });

  it('nimmt einen Inhalt genau auf der Größengrenze an und lehnt ihn ein Byte darüber ab', () => {
    const atLimit = 'a'.repeat(MAX_PAYLOAD_BYTES);
    const accepted = assertSubmissionAcceptable(
      { payloadKind: PayloadKind.CATALOG, content: atLimit },
      MAX_PAYLOAD_BYTES,
    );

    expect(accepted.contentBytes).toBe(MAX_PAYLOAD_BYTES);

    // Ein zusätzliches Zeichen, das zwei Byte belegt: Die Grenze entscheidet
    // über die Byte-Länge, nicht über die Zeichenzahl.
    const overLimit = `${atLimit}ñ`;

    expect(() =>
      assertSubmissionAcceptable(
        { payloadKind: PayloadKind.CATALOG, content: overLimit },
        MAX_PAYLOAD_BYTES,
      ),
    ).toThrow(`${MAX_PAYLOAD_BYTES + 2} Byte`);
  });

  it('sammelt die Verstöße aller verletzten Felder in einer einzigen Ablehnung', () => {
    let error: SentenzaError | undefined;

    try {
      assertSubmissionAcceptable({ payloadKind: undefined, content: '' }, MAX_PAYLOAD_BYTES);
    } catch (thrown) {
      error = thrown as SentenzaError;
    }

    expect(error?.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(violationsOf(error as SentenzaError).map((violation) => violation.path)).toEqual([
      'input.payloadKind',
      'input.content',
    ]);
    expect(error?.message).toContain('Der Payload-Inhalt ist leer.');
  });
});

describe('RawPayloadRepository.create', () => {
  it('legt den Eintrag zeichengenau mit allen Metadaten ab', async () => {
    const { repository, store } = harness();

    const { entry, submission } = await repository.create(args());

    expect(store.createCalls).toHaveLength(1);

    // Requirement 3.2, 3.3: der Inhalt unverändert, dazu Zeitpunkt, Konto,
    // Payload-Art, Quelle, Größe, Inhalts-Hash und Korrelationskennung.
    expect(store.createCalls[0]?.data).toEqual({
      userAccountId: USER_ACCOUNT_ID,
      payloadKind: PayloadKind.CATALOG,
      submissionSource: SubmissionSource.SENTENZA_EXTENSION,
      submittedAt: SUBMITTED_AT,
      contentBytes: Buffer.byteLength(CONTENT, 'utf8'),
      contentHash: sha256Hex(CONTENT),
      content: CONTENT,
      correlationId: CORRELATION_ID,
      processingState: RAW_PAYLOAD_INITIAL_PROCESSING_STATE,
    });

    expect(entry.id).toBe('roher-payload-1');
    expect(submission.content).toBe(CONTENT);
  });

  it('verwendet den übergebenen Einreichungszeitpunkt statt der Zeitquelle', async () => {
    const { repository, store } = harness();
    const submittedAt = new Date('2026-04-02T08:00:00.000Z');

    await repository.create(args({ submittedAt }));

    expect(store.createCalls[0]?.data.submittedAt).toBe(submittedAt);
  });

  it('legt je Aufruf einen eigenen Eintrag an, auch bei gleichem Inhalt', async () => {
    const { repository, store } = harness();

    const first = await repository.create(args());
    const second = await repository.create(args());

    // Requirement 3.7: gleicher Inhalts-Hash, eigene Kennung je Einreichung.
    expect(first.submission.contentHash).toBe(second.submission.contentHash);
    expect(second.entry.id).not.toBe(first.entry.id);
    expect(store.createCalls).toHaveLength(2);
  });

  it('protokolliert die Ablage mit Inhalts-Hash und Größe, aber ohne den Inhalt', async () => {
    const { repository, lines } = harness();

    await repository.create(args());

    const entries = logEntries(lines);
    const persisted = entries.find((entry) => entry.message === 'Roher Payload abgelegt');

    expect(persisted).toMatchObject({
      step: 'ingestion.rawPayload.create',
      correlationId: CORRELATION_ID,
      rawPayloadId: 'roher-payload-1',
      contentBytes: Buffer.byteLength(CONTENT, 'utf8'),
      contentHash: sha256Hex(CONTENT),
    });
    // Requirement 9.5: der Inhalt selbst erscheint in keinem Eintrag.
    expect(lines.join('\n')).not.toContain('"a": "ñ"');
  });

  it('lehnt einen zu großen Inhalt ab, ohne einen Eintrag anzulegen', async () => {
    const { repository, store, lines } = harness();
    const content = 'x'.repeat(MAX_PAYLOAD_BYTES + 1);

    const error = await rejection(
      repository.create(args({ input: { payloadKind: PayloadKind.CATALOG, content } })),
    );

    // Requirement 3.8: BAD_USER_INPUT und kein Eintrag im Raw_Payload_Store.
    expect(error.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(error.message).toContain(`${MAX_PAYLOAD_BYTES + 1} Byte`);
    expect(error.message).toContain(`${MAX_PAYLOAD_BYTES} Byte`);
    expect(store.createCalls).toEqual([]);

    const rejected = logEntries(lines).find((entry) => entry.message === 'Einreichung abgelehnt');

    expect(rejected).toMatchObject({
      step: 'ingestion.rawPayload.create',
      correlationId: CORRELATION_ID,
      reason: 'bad-user-input',
      violationPaths: ['input.content'],
    });
    // Requirement 9.5: auch der abgelehnte Inhalt erscheint in keinem Eintrag.
    expect(lines.join('\n')).not.toContain(content);
  });

  it('lehnt einen leeren Inhalt und eine unbekannte Payload-Art ab, ohne einen Eintrag anzulegen', async () => {
    const { repository, store } = harness();

    const emptyContent = await rejection(
      repository.create(args({ input: { payloadKind: PayloadKind.PROGRESS, content: '' } })),
    );
    const unknownKind = await rejection(
      repository.create(args({ input: { payloadKind: 'CATALOGUE', content: CONTENT } })),
    );

    // Requirement 3.11: beides BAD_USER_INPUT, beides ohne Eintrag.
    expect(emptyContent.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(violationsOf(emptyContent).map((violation) => violation.path)).toEqual([
      'input.content',
    ]);
    expect(unknownKind.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(unknownKind.message).toContain('"CATALOGUE"');
    expect(store.createCalls).toEqual([]);
  });
});

describe('RawPayloadStore', () => {
  it('wird von PrismaService erfüllt', () => {
    // Die eigentliche Zusicherung ist der Type-Check dieser Zeile: Ändert
    // Prisma die Signatur von `create` oder die Form von `RawPayload`,
    // schlägt er hier fehl statt die Ablage zur Laufzeit. `PrismaService`
    // wird dabei nicht erzeugt, es wird keine Datenbankverbindung aufgebaut.
    const alsStore = (prisma: PrismaService): RawPayloadStore => prisma;

    expect(alsStore).toBeTypeOf('function');
  });
});
