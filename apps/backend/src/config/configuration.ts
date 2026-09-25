import { TargetLanguage } from '@sentenza/domain';
import { z } from 'zod';

import { ConfigValidationError } from './config-validation.error.js';

/**
 * SentenzaConfig: die validierte, getippte Sicht auf `process.env`.
 *
 * Einzige Quelle für Konfigurationswerte im Backend (design.md, Abschnitt
 * "Konfiguration und Bootstrap"). Niemand liest `process.env` direkt außer
 * `loadConfig` selbst.
 */
export interface SentenzaConfig {
  port: number;
  databaseUrl: string;
  google: {
    clientId: string;
    issuer: string;
    jwksUri: string;
    jwksTimeoutMs: number;
  };
  auth: {
    allowedEmails: string[];
    jwtSecret: string;
    accessTokenTtlMinutes: number;
    refreshTokenTtlDays: number;
  };
  ingestion: { maxPayloadBytes: number; defaultTargetLanguage: TargetLanguage };
  startup: { databaseTimeoutMs: number };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const ACCESS_TOKEN_TTL_MINUTES_MIN = 5;
const ACCESS_TOKEN_TTL_MINUTES_MAX = 60;
const ACCESS_TOKEN_TTL_MINUTES_DEFAULT = 15;
const REFRESH_TOKEN_TTL_DAYS_DEFAULT = 30;
const INGESTION_MAX_PAYLOAD_BYTES_DEFAULT = 10_485_760;
const DB_STARTUP_TIMEOUT_MS_DEFAULT = 60_000;
const LOG_LEVEL_DEFAULT = 'info';

/** Nicht-leere Zeichenkette nach `trim()`; deckt fehlende und leere Variablen ab. */
const requiredString = (variableName: string) =>
  z
    .string({
      required_error: `${variableName} fehlt`,
      invalid_type_error: `${variableName} fehlt`,
    })
    .trim()
    .min(1, `${variableName} fehlt`);

/** Zeichenkette, die vollständig eine ganze Zahl darstellt, geparst zu `number`. */
const intString = (variableName: string) =>
  requiredString(variableName)
    .regex(/^-?\d+$/, `${variableName} muss eine ganze Zahl sein`)
    .transform((value) => Number.parseInt(value, 10));

/**
 * `AUTH_ALLOWED_EMAILS`: kommagetrennt, jeder Eintrag getrimmt. Groß-
 * /Kleinschreibung bleibt hier unverändert — der fallunabhängige Vergleich
 * gegen die E-Mail-Adresse des Google_ID_Token erfolgt erst bei der
 * Freigabeprüfung in Auth_Service (design.md, Abschnitt "Freigabeliste").
 */
const allowedEmailsSchema = requiredString('AUTH_ALLOWED_EMAILS').transform((value) =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0),
);

/** Leere oder fehlende Umgebungsvariable auf `undefined` normalisieren. */
const optionalTrimmed = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));

const accessTokenTtlMinutesSchema = optionalTrimmed()
  .pipe(
    z
      .string()
      .regex(/^-?\d+$/, 'ACCESS_TOKEN_TTL_MINUTES muss eine ganze Zahl sein')
      .transform((value) => Number.parseInt(value, 10))
      .refine(
        (value) => value >= ACCESS_TOKEN_TTL_MINUTES_MIN && value <= ACCESS_TOKEN_TTL_MINUTES_MAX,
        {
          message: `ACCESS_TOKEN_TTL_MINUTES muss zwischen ${ACCESS_TOKEN_TTL_MINUTES_MIN} und ${ACCESS_TOKEN_TTL_MINUTES_MAX} liegen`,
        },
      )
      .optional(),
  )
  .transform((value) => value ?? ACCESS_TOKEN_TTL_MINUTES_DEFAULT);

const optionalIntString = (variableName: string, defaultValue: number) =>
  optionalTrimmed()
    .pipe(
      z
        .string()
        .regex(/^-?\d+$/, `${variableName} muss eine ganze Zahl sein`)
        .transform((value) => Number.parseInt(value, 10))
        .optional(),
    )
    .transform((value) => value ?? defaultValue);

const defaultTargetLanguageSchema = optionalTrimmed()
  .transform((value) => value?.toUpperCase())
  .pipe(z.nativeEnum(TargetLanguage).optional())
  .transform((value) => value ?? TargetLanguage.ES);

const logLevelSchema = optionalTrimmed()
  .pipe(z.enum(['debug', 'info', 'warn', 'error']).optional())
  .transform((value) => value ?? LOG_LEVEL_DEFAULT);

/**
 * Zod-Schema für `process.env`. Bildet direkt auf die verschachtelte Form von
 * `SentenzaConfig` ab, damit ein einziger `parse`-Aufruf sowohl validiert als
 * auch transformiert.
 *
 * `TEST_DATABASE_URL`, `SENTENZA_BACKEND_URL` und `SENTENZA_GOOGLE_CLIENT_ID`
 * sind bewusst nicht Teil dieses Schemas: Erstere wird ausschließlich von der
 * Testinfrastruktur gelesen (nicht von der laufenden Anwendung), die beiden
 * anderen ausschließlich von Sentenza_Extension.
 */
const envSchema = z
  .object({
    PORT: intString('PORT'),
    DATABASE_URL: requiredString('DATABASE_URL'),
    GOOGLE_CLIENT_ID: requiredString('GOOGLE_CLIENT_ID'),
    GOOGLE_ISSUER: requiredString('GOOGLE_ISSUER'),
    GOOGLE_JWKS_URI: requiredString('GOOGLE_JWKS_URI'),
    GOOGLE_JWKS_TIMEOUT_MS: intString('GOOGLE_JWKS_TIMEOUT_MS'),
    AUTH_ALLOWED_EMAILS: allowedEmailsSchema,
    JWT_SECRET: requiredString('JWT_SECRET'),
    ACCESS_TOKEN_TTL_MINUTES: accessTokenTtlMinutesSchema,
    REFRESH_TOKEN_TTL_DAYS: optionalIntString(
      'REFRESH_TOKEN_TTL_DAYS',
      REFRESH_TOKEN_TTL_DAYS_DEFAULT,
    ),
    INGESTION_MAX_PAYLOAD_BYTES: optionalIntString(
      'INGESTION_MAX_PAYLOAD_BYTES',
      INGESTION_MAX_PAYLOAD_BYTES_DEFAULT,
    ),
    DEFAULT_TARGET_LANGUAGE: defaultTargetLanguageSchema,
    DB_STARTUP_TIMEOUT_MS: optionalIntString(
      'DB_STARTUP_TIMEOUT_MS',
      DB_STARTUP_TIMEOUT_MS_DEFAULT,
    ),
    LOG_LEVEL: logLevelSchema,
  })
  .passthrough();

/**
 * Liest und validiert `process.env`. Wirft `ConfigValidationError` mit einer
 * Nachricht, die jede fehlende oder unzulässige Variable benennt, sodass der
 * Start abbricht, bevor Nest einen Port öffnet (Requirement 1.12).
 */
export function loadConfig(env: NodeJS.ProcessEnv): SentenzaConfig {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(env)';
      return `${path}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  const parsed = result.data;

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    google: {
      clientId: parsed.GOOGLE_CLIENT_ID,
      issuer: parsed.GOOGLE_ISSUER,
      jwksUri: parsed.GOOGLE_JWKS_URI,
      jwksTimeoutMs: parsed.GOOGLE_JWKS_TIMEOUT_MS,
    },
    auth: {
      allowedEmails: parsed.AUTH_ALLOWED_EMAILS,
      jwtSecret: parsed.JWT_SECRET,
      accessTokenTtlMinutes: parsed.ACCESS_TOKEN_TTL_MINUTES,
      refreshTokenTtlDays: parsed.REFRESH_TOKEN_TTL_DAYS,
    },
    ingestion: {
      maxPayloadBytes: parsed.INGESTION_MAX_PAYLOAD_BYTES,
      defaultTargetLanguage: parsed.DEFAULT_TARGET_LANGUAGE,
    },
    startup: {
      databaseTimeoutMs: parsed.DB_STARTUP_TIMEOUT_MS,
    },
    logLevel: parsed.LOG_LEVEL,
  };
}

export { ConfigValidationError } from './config-validation.error.js';
