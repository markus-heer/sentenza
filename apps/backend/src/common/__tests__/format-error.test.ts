import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import type { GraphQLFormattedError } from 'graphql';
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
