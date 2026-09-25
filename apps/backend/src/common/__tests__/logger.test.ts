import { createHash } from 'node:crypto';

import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  createLogger,
  type LogFields,
  type LogLevel,
  redact,
  REDACTED_FIELD_NAMES,
  type SentenzaLogger,
} from '../logger.js';

const FIXED_NOW = '2026-02-01T12:34:56.789Z';

interface TestLogger {
  readonly logger: SentenzaLogger;
  /** Die geschriebenen Zeilen, unverändert. */
  readonly lines: string[];
  /** Die geschriebenen Zeilen geparst; Index 0 ist der erste Eintrag. */
  readonly entries: () => Record<string, unknown>[];
  /** Der Eintrag an der gegebenen Stelle, für die Prüfung einzelner Felder. */
  readonly entry: (index?: number) => Record<string, unknown>;
}

/**
 * Logger mit eingesetztem Ausgabeziel und fester Zeitquelle. Die Vorgabe
 * `debug` lässt jede Stufe durch; die Schwelle prüft ein eigener Test.
 */
function createTestLogger(level: LogLevel = 'debug'): TestLogger {
  const lines: string[] = [];
  const logger = createLogger({
    component: 'test-component',
    level,
    sink: (line) => lines.push(line),
    now: () => new Date(FIXED_NOW),
  });

  const entries = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  return {
    logger,
    lines,
    entries,
    entry: (index = 0) => entries()[index] ?? {},
  };
}

const sha256Hex = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('createLogger', () => {
  it('schreibt einen Eintrag als eine Zeile JSON mit timestamp, component, correlationId, level und message', () => {
    const { logger, lines, entry } = createTestLogger();

    logger.info('Verarbeitung begonnen', { correlationId: 'corr-1' });

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('\n');
    expect(entry()).toEqual({
      timestamp: FIXED_NOW,
      component: 'test-component',
      correlationId: 'corr-1',
      level: 'info',
      message: 'Verarbeitung begonnen',
    });
  });

  it('nimmt auch die Objektform ohne Nachricht an, wie sie der Fehlerformatierer verwendet', () => {
    const { logger, entry } = createTestLogger();

    logger.error({ correlationId: 'corr-2', causeChain: [{ name: 'Error', message: 'kaputt' }] });

    expect(entry().level).toBe('error');
    expect(entry().message).toBe('');
    expect(entry().causeChain).toEqual([{ name: 'Error', message: 'kaputt' }]);
  });

  it('ergänzt rawPayloadId und step nur, wenn die Aufrufstelle sie kennt', () => {
    const { logger, entry } = createTestLogger();

    logger.error('Normalisierung fehlgeschlagen', {
      correlationId: 'corr-3',
      rawPayloadId: 'payload-7',
      step: 'NORMALIZE',
    });
    logger.info('ohne Bezug zu einem Eintrag', { correlationId: 'corr-3' });

    expect(entry(0).rawPayloadId).toBe('payload-7');
    expect(entry(0).step).toBe('NORMALIZE');
    expect(entry(1)).not.toHaveProperty('rawPayloadId');
    expect(entry(1)).not.toHaveProperty('step');
  });

  it('erzeugt eine Korrelationskennung, wenn keine mitgegeben wurde', () => {
    const { logger, entry } = createTestLogger();

    logger.warn('ohne Korrelationskennung');

    expect(typeof entry().correlationId).toBe('string');
    expect(entry().correlationId).not.toBe('');
  });

  it('unterdrückt Einträge unterhalb der Schwelle und schreibt Einträge auf oder über ihr', () => {
    const { logger, entries } = createTestLogger('warn');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');

    expect(entries().map((logged) => logged.level)).toEqual(['warn', 'error']);
  });

  it('trägt feste Felder eines abgeleiteten Loggers an jeden Eintrag', () => {
    const { logger, entries } = createTestLogger();

    const ingestionLogger = logger.child({ correlationId: 'corr-4', rawPayloadId: 'payload-9' });
    ingestionLogger.info('Schritt eins', { step: 'PERSIST_RAW' });
    ingestionLogger.info('Schritt zwei', { step: 'NORMALIZE' });

    for (const logged of entries()) {
      expect(logged.correlationId).toBe('corr-4');
      expect(logged.rawPayloadId).toBe('payload-9');
    }
    expect(entries().map((logged) => logged.step)).toEqual(['PERSIST_RAW', 'NORMALIZE']);
  });

  it('lässt ein Feld der Aufrufstelle ein festes Feld überschreiben', () => {
    const { logger, entry } = createTestLogger();

    logger
      .child({ correlationId: 'binding' })
      .info('überschrieben', { correlationId: 'aufrufstelle' });

    expect(entry().correlationId).toBe('aufrufstelle');
  });

  it('redigiert Geheimnisse und Payload-Inhalte auf dem Weg in die Ausgabe', () => {
    const { logger, lines, entry } = createTestLogger();
    const content = '{"grammar_categories":[]}';

    logger.error('Anmeldung fehlgeschlagen', {
      correlationId: 'corr-5',
      idToken: 'ey.super-geheim.1',
      request: { headers: { Authorization: 'Bearer ey.super-geheim.2' } },
      payload: { content },
    });

    expect(lines.join('\n')).not.toContain('super-geheim');
    expect(entry()).not.toHaveProperty('idToken');
    expect(entry().request).toEqual({ headers: {} });
    expect(entry().payload).toEqual({
      contentHash: sha256Hex(content),
      contentBytes: Buffer.byteLength(content, 'utf8'),
    });
  });
});

describe('redact', () => {
  it('entfernt jeden Feldnamen der Redaction-Liste', () => {
    const input = Object.fromEntries(REDACTED_FIELD_NAMES.map((name) => [name, 'geheim']));

    const result = redact(input) as Record<string, unknown>;

    for (const name of REDACTED_FIELD_NAMES) {
      expect(result).not.toHaveProperty(name);
    }
    expect(JSON.stringify(result)).not.toContain('geheim');
  });

  it('greift unabhängig von Schreibweise und Trennzeichen des Feldnamens', () => {
    const result = redact({
      Authorization: 'Bearer geheim',
      id_token: 'geheim',
      'refresh-token': 'geheim',
      JWT_SECRET: 'geheim',
    });

    expect(result).toEqual({});
  });

  it('ersetzt einen Inhalt durch contentHash und contentBytes', () => {
    const content = 'Sätze mit Umlauten: Grüße';

    expect(redact({ content })).toEqual({
      contentHash: sha256Hex(content),
      contentBytes: Buffer.byteLength(content, 'utf8'),
    });
  });

  it('lässt einen von der Aufrufstelle mitgegebenen contentHash unangetastet', () => {
    const result = redact({ content: 'abc', contentHash: 'vom-eintrag', contentBytes: 3 });

    expect(result).toEqual({ contentHash: 'vom-eintrag', contentBytes: 3 });
  });

  it('beschreibt auch einen nicht als Zeichenkette vorliegenden Nachrichtenkörper über Hash und Größe', () => {
    const body = { items: [1, 2, 3] };
    const serialized = JSON.stringify(body);

    expect(redact({ body })).toEqual({
      contentHash: sha256Hex(serialized),
      contentBytes: Buffer.byteLength(serialized, 'utf8'),
    });
  });

  it('redigiert innerhalb von Listen und verschachtelten Objekten', () => {
    const result = redact({
      sessions: [
        { accessToken: 'a', userId: 'u1' },
        { accessToken: 'b', userId: 'u2' },
      ],
    });

    expect(result).toEqual({ sessions: [{ userId: 'u1' }, { userId: 'u2' }] });
  });

  it('bildet einen Fehler auf Name, Nachricht und Ursachenkette ab, niemals auf den Aufrufstapel', () => {
    const root = new Error('Wurzelursache');
    const top = new Error('oberste Ursache', { cause: root });
    top.stack = 'Error: oberste Ursache\n    at /geheimer/pfad/db.ts:1:1';

    const result = redact({ error: top }) as Record<string, unknown>;

    expect(result.error).toEqual({
      name: 'Error',
      message: 'oberste Ursache',
      cause: { name: 'Error', message: 'Wurzelursache' },
    });
    expect(JSON.stringify(result)).not.toContain('/geheimer/pfad');
  });

  it('lässt unbedenkliche Werte unverändert und wandelt Date und bigint in serialisierbare Formen', () => {
    const result = redact({
      count: 3,
      flag: false,
      missing: null,
      at: new Date('2026-02-01T00:00:00.000Z'),
      big: 9007199254740993n,
    });

    expect(result).toEqual({
      count: 3,
      flag: false,
      missing: null,
      at: '2026-02-01T00:00:00.000Z',
      big: '9007199254740993',
    });
  });

  it('ersetzt nicht serialisierbare Werte durch einen Platzhalter', () => {
    const result = redact({ handler: () => undefined, marker: Symbol('x') }) as Record<
      string,
      unknown
    >;

    expect(result.handler).toBe('[nicht serialisierbar]');
    expect(result.marker).toBe('[nicht serialisierbar]');
  });

  it('schneidet Zyklen und übermäßige Tiefe mit Platzhaltern ab, statt zu scheitern', () => {
    const cyclic: Record<string, unknown> = { name: 'Wurzel' };
    cyclic.self = cyclic;

    expect(redact(cyclic)).toEqual({ name: 'Wurzel', self: '[Zyklus]' });

    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'zu tief' } } } } } } } } };
    const serializedDeep = JSON.stringify(redact(deep));

    expect(serializedDeep).toContain('[zu tief verschachtelt]');
    expect(serializedDeep).not.toContain('"zu tief"');
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 38: Geheimnisse und
 * Payload-Inhalte erscheinen in keinem Protokolleintrag.
 *
 * **Validates: Requirements 9.5**
 *
 * Geprüft wird der Logger als reine Funktion über einer breiten Menge
 * erzeugter Einträge: Zugangsdaten, Google_ID_Token, Sentenza_Access_Token,
 * Sentenza_Refresh_Token und Payload-Inhalt stehen an erzeugten Stellen des
 * Eintrags — unmittelbar an den Feldern der Aufrufstelle, an den festen
 * Feldern eines abgeleiteten Loggers, in verschachtelten Objekten und in
 * Listen, in erzeugter Tiefe und in wechselnder Schreibweise des Feldnamens.
 *
 * Jeder erzeugte Wert trägt einen eindeutigen Marker, dessen Abwesenheit in
 * der geschriebenen Zeile geprüft wird; für den Payload-Inhalt wird zusätzlich
 * geprüft, dass an jeder seiner Stellen genau sein Inhalts-Hash und seine
 * Größe in Byte erscheinen.
 */

/**
 * Schreibweisen, in denen ein geheimnistragender Feldname in Fremddaten
 * tatsächlich vorkommt: `Authorization` als HTTP-Kopfzeile, `id_token` und
 * `access_token` aus einer Google-Tokenantwort, `refresh-token` aus einer
 * Nachricht der Extension.
 */
const SECRET_SPELLINGS = [
  'idToken',
  'id_token',
  'ID-TOKEN',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh-token',
  'authorization',
  'Authorization',
  'jwtSecret',
  'JWT_SECRET',
] as const;

/** Schreibweisen eines inhaltstragenden Feldnamens. */
const CONTENT_SPELLINGS = ['content', 'Content', 'CONTENT', 'body', 'Body', 'body_'] as const;

/** Ein Schritt auf dem Weg von der Wurzel des Eintrags zum redigierten Feld. */
type NestStep = { readonly kind: 'object'; readonly key: string } | { readonly kind: 'array' };

const nestStepArb: fc.Arbitrary<NestStep> = fc.oneof(
  fc.record({
    kind: fc.constant('object' as const),
    key: fc.constantFrom('request', 'headers', 'payload', 'submission', 'context'),
  }),
  fc.record({ kind: fc.constant('array' as const) }),
);

/**
 * Höchstlänge des Weges. Der Logger schneidet ab einer Tiefe von acht ab; bei
 * höchstens fünf Schritten liegt das redigierte Feld immer innerhalb dieser
 * Grenze, sodass jeder Durchlauf die Redaction tatsächlich abfragt statt
 * lediglich den Tiefenschnitt zu beobachten.
 */
const MAX_NEST_STEPS = 5;

/** Stelle eines redigierten Feldes: der Weg dorthin und die Schreibweise des Feldnamens. */
interface Placement {
  readonly steps: readonly NestStep[];
  readonly key: string;
}

const placementArb = (spellings: readonly [string, ...string[]]): fc.Arbitrary<Placement> =>
  fc.record({
    steps: fc.array(nestStepArb, { maxLength: MAX_NEST_STEPS }),
    key: fc.constantFrom(...spellings),
  });

/**
 * Legt das Blatt an das Ende des erzeugten Weges. Ein Listenschritt umgibt es
 * mit harmlosen Nachbarelementen, damit die Redaction innerhalb von Listen
 * geprüft wird und nicht nur am einzigen Element.
 */
function wrap(steps: readonly NestStep[], leaf: Record<string, unknown>): unknown {
  let current: unknown = leaf;

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]!;
    current =
      step.kind === 'array'
        ? [{ userId: 'u-1' }, current, { userId: 'u-2' }]
        : { [step.key]: current, harmlos: 'sichtbar' };
  }

  return current;
}

/** Ein erzeugter Ablauf: die Felder eines Eintrags und die darin verborgenen Werte. */
interface Scenario {
  readonly level: LogLevel;
  readonly message: string;
  readonly bindings: LogFields;
  readonly fields: LogFields;
  /** Marker, der in jedem geheimnistragenden Wert dieses Ablaufs steckt. */
  readonly secretMarker: string;
  /** Marker, der im Payload-Inhalt dieses Ablaufs steckt. */
  readonly contentMarker: string;
  readonly content: string;
  /** Anzahl der Objekte, an denen Inhalts-Hash und Größe erscheinen müssen. */
  readonly contentContainers: number;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    token: fc.integer({ min: 0x10000000, max: 0x7fffffff }),
    fillerLength: fc.integer({ min: 0, max: 40 }),
    level: fc.constantFrom<LogLevel>('debug', 'info', 'warn', 'error'),
    message: fc.constantFrom(
      'Anmeldung fehlgeschlagen',
      'Einreichung entgegengenommen',
      'Normalisierung abgebrochen',
    ),
    correlationId: fc.uuid(),
    secretPlacements: fc.array(placementArb(SECRET_SPELLINGS), { minLength: 1, maxLength: 3 }),
    contentPlacements: fc.array(placementArb(CONTENT_SPELLINGS), { minLength: 1, maxLength: 3 }),
    secretAtTopLevel: fc.option(fc.constantFrom(...SECRET_SPELLINGS), { nil: undefined }),
    secretInBindings: fc.option(fc.constantFrom(...SECRET_SPELLINGS), { nil: undefined }),
    contentAtTopLevel: fc.option(fc.constantFrom(...CONTENT_SPELLINGS), { nil: undefined }),
  })
  .map((generated) => {
    const secretMarker = `geheim-${generated.token.toString(36)}`;
    const contentMarker = `inhalt-${generated.token.toString(36)}`;
    const content = `{"grammar_categories":[{"id":"${contentMarker}","text":"${'x'.repeat(generated.fillerLength)}"}]}`;
    const secretValue = (key: string) =>
      key.toLowerCase().startsWith('auth') ? `Bearer ey.${secretMarker}` : `ey.${secretMarker}.sig`;

    const fields: LogFields = { rawPayloadId: `payload-${generated.token}` };
    const bindings: LogFields = { correlationId: generated.correlationId };
    let contentContainers = 0;

    generated.secretPlacements.forEach((placement, index) => {
      fields[`geheimnis${index}`] = wrap(placement.steps, {
        [placement.key]: secretValue(placement.key),
        harmlos: 'sichtbar',
      });
    });

    generated.contentPlacements.forEach((placement, index) => {
      fields[`inhalt${index}`] = wrap(placement.steps, {
        [placement.key]: content,
        harmlos: 'sichtbar',
      });
      contentContainers += 1;
    });

    if (generated.secretAtTopLevel !== undefined) {
      fields[generated.secretAtTopLevel] = secretValue(generated.secretAtTopLevel);
    }

    if (generated.secretInBindings !== undefined) {
      bindings[generated.secretInBindings] = secretValue(generated.secretInBindings);
    }

    if (generated.contentAtTopLevel !== undefined) {
      fields[generated.contentAtTopLevel] = content;
      contentContainers += 1;
    }

    return {
      level: generated.level,
      message: generated.message,
      bindings,
      fields,
      secretMarker,
      contentMarker,
      content,
      contentContainers,
    };
  });

/** Alle Feldnamen sowie alle Werte von `contentHash` und `contentBytes` eines Eintrags. */
interface Collected {
  readonly keys: string[];
  readonly hashes: unknown[];
  readonly bytes: unknown[];
}

function collect(value: unknown, into: Collected): void {
  if (Array.isArray(value)) {
    for (const element of value) {
      collect(element, into);
    }
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  for (const [key, entry] of Object.entries(value)) {
    into.keys.push(key);

    if (key === 'contentHash') {
      into.hashes.push(entry);
    } else if (key === 'contentBytes') {
      into.bytes.push(entry);
    } else {
      collect(entry, into);
    }
  }
}

/** Vergleichsform eines Feldnamens, wie sie die Redaction verwendet. */
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const REDACTED_KEYS = new Set(REDACTED_FIELD_NAMES.map(normalize));

describe('createLogger (Property 38)', () => {
  it('schreibt an keiner Stelle ein Geheimnis oder einen Payload-Inhalt, sondern ausschließlich dessen Hash und Größe', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const lines: string[] = [];
        const logger = createLogger({
          component: 'test-component',
          level: 'debug',
          sink: (line) => lines.push(line),
          now: () => new Date(FIXED_NOW),
        }).child(scenario.bindings);

        logger[scenario.level](scenario.message, scenario.fields);

        expect(lines).toHaveLength(1);
        const line = lines[0]!;

        // Kein Geheimnis und kein Payload-Inhalt als Teilzeichenkette des Eintrags.
        expect(line).not.toContain(scenario.secretMarker);
        expect(line).not.toContain(scenario.contentMarker);
        expect(line).not.toContain(scenario.content);

        const collected: Collected = { keys: [], hashes: [], bytes: [] };
        collect(JSON.parse(line), collected);

        // Kein Feldname der Redaction-Liste überlebt, gleich in welcher Schreibweise.
        for (const key of collected.keys) {
          expect(REDACTED_KEYS.has(normalize(key))).toBe(false);
        }

        // Anstelle des Inhalts erscheinen an jeder seiner Stellen genau
        // Inhalts-Hash und Größe in Byte.
        const expectedHash = sha256Hex(scenario.content);
        const expectedBytes = Buffer.byteLength(scenario.content, 'utf8');
        expect(collected.hashes).toEqual(Array(scenario.contentContainers).fill(expectedHash));
        expect(collected.bytes).toEqual(Array(scenario.contentContainers).fill(expectedBytes));
      }),
      { numRuns: 100 },
    );
  });
});
