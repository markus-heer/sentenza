import 'reflect-metadata';

import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import {
  createValidationException,
  type ValidationViolation,
} from '../../common/validation-exception-factory.js';
import { RefreshAccessTokenInput } from '../models/refresh-access-token.input.js';

/**
 * Tests für die deklarierte Validierung von `RefreshAccessTokenInput`
 * (Requirement 9.2).
 *
 * Aufbau wie in `sign-in-with-google.input.test.ts`: dieselbe
 * `ValidationPipe`-Einrichtung wie in `main.ts`, unmittelbar aufgerufen, ohne
 * Nest-Container.
 */

const PIPE = new ValidationPipe({ exceptionFactory: createValidationException });

const METADATA: ArgumentMetadata = {
  type: 'body',
  metatype: RefreshAccessTokenInput,
  data: 'input',
};

/** Nimmt eine erwartete Ablehnung ab und gibt sie zur weiteren Prüfung zurück. */
async function rejectionOf(value: unknown): Promise<SentenzaError> {
  try {
    await PIPE.transform(value, METADATA);
  } catch (error) {
    if (error instanceof SentenzaError) {
      return error;
    }

    expect.fail(`Erwartet war ein SentenzaError, beobachtet wurde: ${String(error)}`);
  }

  return expect.fail('Erwartet war eine Ablehnung, die Eingabe ging jedoch durch.');
}

describe('RefreshAccessTokenInput', () => {
  it('lässt ein nicht leeres Refresh-Token durch', async () => {
    const input = (await PIPE.transform(
      { refreshToken: 'Zm9vYmFyLWJhc2U2NHVybC10b2tlbg' },
      METADATA,
    )) as RefreshAccessTokenInput;

    // Über die Vorlagefähigkeit entscheidet der gespeicherte Datensatz
    // (Requirement 2.14), nicht die Form der Zeichenkette.
    expect(input.refreshToken).toBe('Zm9vYmFyLWJhc2U2NHVybC10b2tlbg');
  });

  it('lehnt ein leeres Token mit BAD_USER_INPUT ab und nennt den Feldpfad', async () => {
    const rejection = await rejectionOf({ refreshToken: '' });

    // Requirement 9.2: `BAD_USER_INPUT` und das verletzte Feld mit seinem Pfad
    // innerhalb der Eingabe.
    expect(rejection.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect((rejection.details?.violations as ValidationViolation[]).map((v) => v.path)).toEqual([
      'refreshToken',
    ]);
  });

  it('lehnt eine Eingabe ohne Feld ab', async () => {
    const rejection = await rejectionOf({});

    expect(rejection.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect((rejection.details?.violations as ValidationViolation[]).map((v) => v.path)).toEqual([
      'refreshToken',
    ]);
  });
});
