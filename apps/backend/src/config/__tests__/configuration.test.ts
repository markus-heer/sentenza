import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ConfigValidationError } from '../config-validation.error.js';
import { loadConfig } from '../configuration.js';

/**
 * Eine gültige Basis-Umgebung mit allen acht benötigten Variablen. Die sechs
 * mit Vorgabewert versehenen Variablen bleiben absichtlich unbesetzt: sie
 * verhindern das Fehlschlagen von `loadConfig` nie und sind für Property 40
 * ohne Belang.
 */
const VALID_BASE_ENV: Record<string, string> = {
  PORT: '4000',
  DATABASE_URL: 'postgresql://sentenza:sentenza@localhost:5432/sentenza',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_ISSUER: 'https://accounts.google.com',
  GOOGLE_JWKS_URI: 'https://www.googleapis.com/oauth2/v3/certs',
  GOOGLE_JWKS_TIMEOUT_MS: '5000',
  AUTH_ALLOWED_EMAILS: 'du@example.com',
  JWT_SECRET: 'test-secret',
};

const REQUIRED_VARS = Object.keys(VALID_BASE_ENV);

describe('loadConfig', () => {
  // Feature: backend-busuu-ingestion, Property 40: Eine unvollständige Konfiguration verhindert den Start
  it('bricht für jede nicht-leere Teilmenge fehlender benötigter Variablen ab und benennt jeden fehlenden Namen', () => {
    fc.assert(
      fc.property(fc.subarray(REQUIRED_VARS, { minLength: 1 }), (removedNames) => {
        const env: Record<string, string> = { ...VALID_BASE_ENV };
        for (const name of removedNames) {
          delete env[name];
        }

        let thrown: unknown;
        try {
          loadConfig(env);
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(ConfigValidationError);

        const message = (thrown as ConfigValidationError).message;
        for (const name of removedNames) {
          expect(message).toContain(name);
        }
      }),
      { numRuns: 100 },
    );
  });
});
