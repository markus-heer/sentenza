import 'reflect-metadata';

import { type ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import {
  createValidationException,
  type ValidationViolation,
} from '../../common/validation-exception-factory.js';
import { SignInWithGoogleInput } from '../models/sign-in-with-google.input.js';

/**
 * Tests für die deklarierte Validierung von `SignInWithGoogleInput`
 * (Requirement 9.2).
 *
 * Geprüft wird durch dieselbe `ValidationPipe`, die `main.ts` global
 * einrichtet, samt derselben `exceptionFactory`. Der Aufruf geht unmittelbar an
 * `transform`, ohne Nest-Container und ohne laufende GraphQL-Schicht: Gefragt
 * ist, was diese Eingabe für gültig hält und welchen Feldpfad eine Verletzung
 * nennt — nicht, ob Nest die Pipe verdrahtet.
 */

const PIPE = new ValidationPipe({ exceptionFactory: createValidationException });

/**
 * Die Beschreibung des Arguments, wie die Pipe sie erhält. `type: 'body'` ist
 * die Einordnung, unter der Nest ein Argumentobjekt prüft; entscheidend ist
 * allein `metatype`, denn daran hängen die Regeln von `class-validator`.
 */
const METADATA: ArgumentMetadata = {
  type: 'body',
  metatype: SignInWithGoogleInput,
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

describe('SignInWithGoogleInput', () => {
  it('lässt ein nicht leeres Google-ID-Token durch', async () => {
    const input = (await PIPE.transform(
      { idToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signatur' },
      METADATA,
    )) as SignInWithGoogleInput;

    // Über die Gültigkeit des Tokens entscheidet `GoogleTokenVerifier`, nicht
    // die Eingabeprüfung: Ein syntaktisch beliebiger Wert darf hier durch.
    expect(input.idToken).toBe('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.signatur');
  });

  it('lehnt ein leeres Token mit BAD_USER_INPUT ab und nennt den Feldpfad', async () => {
    const rejection = await rejectionOf({ idToken: '' });

    // Requirement 9.2: `BAD_USER_INPUT` und das verletzte Feld mit seinem Pfad
    // innerhalb der Eingabe.
    expect(rejection.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect((rejection.details?.violations as ValidationViolation[]).map((v) => v.path)).toEqual([
      'idToken',
    ]);
  });

  it('lehnt eine Eingabe ohne Feld ab', async () => {
    // Das Schema verlangt `idToken: String!`; die Pipe ist die zweite Schranke
    // und entscheidet auch dann, wenn das Feld gar nicht vorkommt.
    const rejection = await rejectionOf({});

    expect(rejection.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect((rejection.details?.violations as ValidationViolation[]).map((v) => v.path)).toEqual([
      'idToken',
    ]);
  });
});
