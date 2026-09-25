import { describe, expect, it } from 'vitest';

import { SentenzaError, SentenzaErrorCode } from '../error-code.js';

/**
 * Grenzfalltests für die geteilte Fehlercode-Enumeration und die
 * Fehlerklasse `SentenzaError` (Requirement 9.1, 10.10).
 *
 * `SentenzaErrorCode` besitzt keine in den Requirements beschriebene
 * Fehler- oder Verwerfungsbedingung; Requirement 10.10 verlangt für einen
 * solchen Fall stattdessen einen Grenzfalltest. Hier ist der Grenzfall die
 * Vollständigkeit der Enumeration selbst, von der der Apollo-Fehlerformatierer
 * und andere Konsumenten Exhaustivität erwarten (Requirement 9.1).
 */
describe('SentenzaErrorCode', () => {
  it('umfasst genau die fünf vorgeschriebenen Werte, nicht mehr und nicht weniger', () => {
    expect(Object.values(SentenzaErrorCode).sort()).toEqual(
      [
        'UNAUTHENTICATED',
        'FORBIDDEN',
        'BAD_USER_INPUT',
        'UPSTREAM_UNAVAILABLE',
        'INTERNAL_SERVER_ERROR',
      ].sort(),
    );
  });
});

describe('SentenzaError', () => {
  it('setzt code, message und details, wenn details übergeben werden', () => {
    const details = { field: 'email' };
    const error = new SentenzaError(SentenzaErrorCode.BAD_USER_INPUT, 'Ungültige Eingabe', details);

    expect(error.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(error.message).toBe('Ungültige Eingabe');
    expect(error.details).toBe(details);
    expect(error.name).toBe('SentenzaError');
    expect(error instanceof Error).toBe(true);
  });

  it('lässt details undefined, wenn keine details übergeben werden', () => {
    const error = new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, 'Nicht angemeldet');

    expect(error.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(error.message).toBe('Nicht angemeldet');
    expect(error.details).toBeUndefined();
    expect(error.name).toBe('SentenzaError');
    expect(error instanceof Error).toBe(true);
  });
});
