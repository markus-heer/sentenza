import { createHash, randomUUID } from 'node:crypto';

import type { SentenzaConfig } from '../config/configuration.js';

/**
 * Protokollschwelle. Bewusst aus `SentenzaConfig` abgeleitet statt erneut
 * aufgeschrieben, damit `LOG_LEVEL` (config/configuration.ts) und der Logger
 * nicht auseinanderlaufen können. Der Import ist ausschließlich ein
 * Typ-Import und erzeugt zur Laufzeit keine Abhängigkeit.
 */
export type LogLevel = SentenzaConfig['logLevel'];

/**
 * Rangfolge der Schwellen. Als `Record<LogLevel, number>` geschrieben: fällt
 * in `SentenzaConfig` eine Stufe hinzu, schlägt der Type-Check hier fehl.
 */
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Feldnamen, deren Wert niemals in einem Protokolleintrag erscheint
 * (Requirement 9.5, design.md Abschnitt "Protokollierung und Redaction").
 *
 * Geheimnisse werden ersatzlos entfernt; inhaltstragende Felder werden durch
 * `contentHash` und `contentBytes` ersetzt.
 */
const SECRET_FIELD_NAMES = [
  'idToken',
  'accessToken',
  'refreshToken',
  'authorization',
  'jwtSecret',
] as const;

/** Felder, die einen Payload-Inhalt tragen können (Requirement 9.5). */
const CONTENT_FIELD_NAMES = ['content', 'body'] as const;

/** Die vollständige Redaction-Liste, auch für Tests und Prüfungen nutzbar. */
export const REDACTED_FIELD_NAMES: readonly string[] = [
  ...SECRET_FIELD_NAMES,
  ...CONTENT_FIELD_NAMES,
];

/**
 * Vergleichsform eines Feldnamens: klein geschrieben und ohne Trennzeichen.
 *
 * Damit greift die Redaction auch auf Schreibweisen, die in Fremddaten
 * tatsächlich vorkommen — `Authorization` als HTTP-Kopfzeile, `id_token` und
 * `access_token` aus einer Google-Tokenantwort, `refresh-token` aus einer
 * Nachricht der Extension. Eine Liste in genau einer Schreibweise würde
 * gerade die Fälle durchlassen, für die sie gedacht ist.
 */
function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SECRET_KEYS = new Set(SECRET_FIELD_NAMES.map(normalizeFieldName));
const CONTENT_KEYS = new Set(CONTENT_FIELD_NAMES.map(normalizeFieldName));

/** Obergrenze der Rekursionstiefe; darunterliegende Zweige werden ersetzt. */
const MAX_DEPTH = 8;
const TOO_DEEP = '[zu tief verschachtelt]';
const CYCLE = '[Zyklus]';
const UNSERIALIZABLE = '[nicht serialisierbar]';

/** SHA-256 in Hex über den Inhalt, identisch zur Ablage im Raw_Payload_Store. */
function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Ersatz für einen Payload-Inhalt: ausschließlich Hash und Größe
 * (Requirement 9.5). Nicht-Zeichenketten werden zuvor serialisiert, damit
 * auch ein bereits geparster Nachrichtenkörper eine Größe und einen Hash
 * bekommt statt stillschweigend zu verschwinden.
 */
function describeContent(
  value: unknown,
): { contentHash: string; contentBytes: number } | undefined {
  let text: string;

  if (typeof value === 'string') {
    text = value;
  } else if (value === null || value === undefined) {
    return undefined;
  } else {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      return undefined;
    }
  }

  return { contentHash: sha256Hex(text), contentBytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * Beschreibung eines Fehlers ohne Aufrufstapel, analog zu `flattenCauses` in
 * `format-error.ts`: Ein Aufrufstapel gehört in keinen Protokolleintrag und
 * schon gar nicht in eine Antwort (Requirement 9.3).
 */
function describeError(error: Error): Record<string, unknown> {
  const described: Record<string, unknown> = { name: error.name, message: error.message };

  if (error.cause !== undefined) {
    described.cause = error.cause;
  }

  return described;
}

/**
 * Serializer-Hook der Redaction (design.md, Abschnitt "Protokollierung und
 * Redaction"): Läuft den gesamten Eintrag ab und entfernt jeden Wert eines
 * Feldnamens der Redaction-Liste, bevor irgendetwas geschrieben wird.
 *
 * Die Redaction sitzt bewusst hier und nicht an den Aufrufstellen: Eine neue
 * Protokollstelle kann ein Token damit nicht versehentlich ausgeben, auch
 * wenn sie es unbedacht in ein Objekt legt.
 *
 * Verhalten:
 * - Geheimnistragende Felder verschwinden ersatzlos.
 * - Inhaltstragende Felder (`content`, `body`) werden durch `contentHash` und
 *   `contentBytes` ersetzt. Ein am selben Objekt bereits vorhandener Wert
 *   dieser beiden Felder bleibt unangetastet — die Aufrufstelle kennt den am
 *   Eintrag gespeicherten Hash genauer als die Redaction.
 * - `Error` wird auf Name, Nachricht und Ursachenkette abgebildet, nie auf
 *   den Aufrufstapel; `Date` auf ISO 8601; `bigint` auf seine Dezimalform,
 *   weil `JSON.stringify` daran scheitern würde.
 * - Zyklen und übermäßige Tiefe werden durch Platzhalter abgeschnitten, damit
 *   der Logger niemals die Ursache eines Fehlers wird, den er protokollieren
 *   soll.
 */
export function redact(value: unknown): unknown {
  return redactValue(value, new WeakSet(), 0);
}

function redactValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return UNSERIALIZABLE;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (depth >= MAX_DEPTH) {
    return TOO_DEEP;
  }

  if (seen.has(value)) {
    return CYCLE;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      // Indizes sind keine Feldnamen: Elemente werden nur abgestiegen.
      return value.map((entry) => redactValue(entry, seen, depth + 1));
    }

    const source =
      value instanceof Error ? describeError(value) : (value as Record<string, unknown>);

    return redactRecord(source, seen, depth);
  } finally {
    seen.delete(value);
  }
}

function redactRecord(
  source: Record<string, unknown>,
  seen: WeakSet<object>,
  depth: number,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let fromContent: { contentHash: string; contentBytes: number } | undefined;
  let fromBody: { contentHash: string; contentBytes: number } | undefined;

  for (const [key, entry] of Object.entries(source)) {
    const normalized = normalizeFieldName(key);

    if (SECRET_KEYS.has(normalized)) {
      continue; // Geheimnis: ersatzlos entfernt
    }

    if (CONTENT_KEYS.has(normalized)) {
      const described = describeContent(entry);

      if (normalized === 'content') {
        fromContent ??= described;
      } else {
        fromBody ??= described;
      }

      continue;
    }

    result[key] = redactValue(entry, seen, depth + 1);
  }

  // `content` gewinnt gegenüber `body`, falls beides am selben Objekt steht.
  const derivedContent = fromContent ?? fromBody;

  if (derivedContent !== undefined) {
    if (result.contentHash === undefined) {
      result.contentHash = derivedContent.contentHash;
    }
    if (result.contentBytes === undefined) {
      result.contentBytes = derivedContent.contentBytes;
    }
  }

  return result;
}

/**
 * Felder einer Protokollstelle. `message`, `component`, `correlationId`,
 * `rawPayloadId` und `step` sind benannt, weil sie die im Entwurf
 * festgelegte Form des Eintrags bilden (Requirement 9.3, 9.4); jedes weitere
 * Feld ist zulässig und durchläuft die Redaction.
 */
export interface LogFields {
  message?: string;
  component?: string;
  correlationId?: string;
  rawPayloadId?: string;
  step?: string;
  [field: string]: unknown;
}

/** Ziel eines fertig serialisierten Eintrags, genau eine Zeile JSON. */
export type LogSink = (line: string) => void;

export interface CreateLoggerOptions {
  /** Komponente, die protokolliert; erscheint als `component` an jedem Eintrag. */
  component: string;
  /** Schwelle aus `LOG_LEVEL`; Vorgabe `info`. */
  level?: LogLevel;
  /** Feste Felder für jeden Eintrag dieses Loggers, etwa die Korrelationskennung. */
  bindings?: LogFields;
  /** Ausgabeziel; Vorgabe eine Zeile JSON auf der Standardausgabe. */
  sink?: LogSink;
  /** Zeitquelle; ausschließlich für Tests gedacht. */
  now?: () => Date;
}

export interface SentenzaLogger {
  debug(message: string, fields?: LogFields): void;
  debug(fields: LogFields): void;
  info(message: string, fields?: LogFields): void;
  info(fields: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  warn(fields: LogFields): void;
  error(message: string, fields?: LogFields): void;
  error(fields: LogFields): void;
  /**
   * Abgeleiteter Logger mit zusätzlichen festen Feldern. Trägt die
   * Korrelationskennung eines Ingestion_Vorgangs an jeden Eintrag, ohne dass
   * eine Aufrufstelle sie durchreichen muss (Requirement 9.10).
   */
  child(bindings: LogFields): SentenzaLogger;
}

/** Ein Eintrag geht als eine Zeile JSON auf die Standardausgabe. */
const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

/**
 * Strukturierte Protokollierung mit Redaction (design.md, Abschnitt
 * "Protokollierung und Redaction"; Requirement 9.3, 9.4, 9.5).
 *
 * Jeder Eintrag ist eine Zeile JSON und trägt `timestamp` (ISO 8601, UTC),
 * `component`, `correlationId`, `level` und `message`, dazu `rawPayloadId`
 * und `step`, sofern die Aufrufstelle sie kennt. Fehlt eine
 * Korrelationskennung, erzeugt der Logger eine — so ist jeder Eintrag
 * zuordenbar, auch außerhalb eines Ingestion_Vorgangs.
 *
 * Kein Nest-Provider: Der Logger wird auch vom Apollo-Fehlerformatierer und
 * vom Bootstrap gebraucht, also an Stellen ohne Zugriff auf den
 * Abhängigkeitsbaum. Die Konfiguration kommt deshalb als Argument, nicht aus
 * `process.env` — `loadConfig` bleibt die einzige Stelle, die die Umgebung
 * liest.
 */
export function createLogger(options: CreateLoggerOptions): SentenzaLogger {
  const {
    component,
    level = 'info',
    bindings = {},
    sink = defaultSink,
    now = () => new Date(),
  } = options;
  const threshold = LEVEL_ORDER[level];

  function write(entryLevel: LogLevel, first: string | LogFields, second?: LogFields): void {
    if (LEVEL_ORDER[entryLevel] < threshold) {
      return;
    }

    const fields: LogFields =
      typeof first === 'string' ? { ...second, message: first } : { ...first };
    const merged: LogFields = { ...bindings, ...fields };
    const {
      message,
      component: fieldComponent,
      correlationId,
      rawPayloadId,
      step,
      ...rest
    } = merged;

    // Feste Reihenfolge der Schlüssel, damit Einträge über alle Komponenten
    // hinweg gleich aussehen und maschinell gut lesbar bleiben.
    const entry: Record<string, unknown> = {
      timestamp: now().toISOString(),
      component: fieldComponent ?? component,
      correlationId: correlationId ?? randomUUID(),
      level: entryLevel,
      message: message ?? '',
    };

    if (rawPayloadId !== undefined) {
      entry.rawPayloadId = rawPayloadId;
    }
    if (step !== undefined) {
      entry.step = step;
    }

    Object.assign(entry, rest);

    sink(serialize(redact(entry) as Record<string, unknown>));
  }

  return {
    debug: (first: string | LogFields, second?: LogFields) => write('debug', first, second),
    info: (first: string | LogFields, second?: LogFields) => write('info', first, second),
    warn: (first: string | LogFields, second?: LogFields) => write('warn', first, second),
    error: (first: string | LogFields, second?: LogFields) => write('error', first, second),
    child: (childBindings: LogFields) =>
      createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}

/**
 * Letzte Rückfallebene: Scheitert `JSON.stringify` trotz Redaction — etwa an
 * einem `toJSON`, das selbst wirft —, wird ein Ersatzeintrag geschrieben
 * statt eine Ausnahme aus der Protokollstelle zu werfen.
 */
function serialize(entry: Record<string, unknown>): string {
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({
      timestamp: entry.timestamp,
      component: entry.component,
      correlationId: entry.correlationId,
      level: entry.level,
      message: UNSERIALIZABLE,
    });
  }
}
