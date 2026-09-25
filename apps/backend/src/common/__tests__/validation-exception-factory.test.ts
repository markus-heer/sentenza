import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import type { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  createValidationException,
  type ValidationViolation,
} from '../validation-exception-factory.js';

function buildValidationError(overrides: Partial<ValidationError>): ValidationError {
  return {
    target: undefined,
    property: 'field',
    value: undefined,
    constraints: undefined,
    children: [],
    contexts: undefined,
    ...overrides,
  } as ValidationError;
}

describe('createValidationException', () => {
  it('bildet eine flache Liste von ValidationError auf einen SentenzaError mit BAD_USER_INPUT ab', () => {
    const errors: ValidationError[] = [
      buildValidationError({
        property: 'content',
        constraints: { isNotEmpty: 'content should not be empty' },
      }),
      buildValidationError({
        property: 'payloadKind',
        constraints: { isEnum: 'payloadKind must be a valid enum value' },
      }),
    ];

    const result = createValidationException(errors);

    expect(result).toBeInstanceOf(SentenzaError);
    expect(result.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);

    const violations = result.details?.violations as ValidationViolation[];
    const paths = violations.map((violation) => violation.path);
    expect(paths).toEqual(['content', 'payloadKind']);
    expect(violations.at(0)?.constraints).toEqual(['content should not be empty']);
  });

  it('löst verschachtelte .children rekursiv auf und baut den vollen Pfad je Ebene', () => {
    const errors: ValidationError[] = [
      buildValidationError({
        property: 'input',
        constraints: undefined,
        children: [
          buildValidationError({
            property: 'items',
            constraints: undefined,
            children: [
              buildValidationError({
                property: '0',
                constraints: undefined,
                children: [
                  buildValidationError({
                    property: 'name',
                    constraints: { isString: 'name must be a string' },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];

    const result = createValidationException(errors);

    const violations = result.details?.violations as ValidationViolation[];
    expect(violations).toHaveLength(1);
    expect(violations.at(0)?.path).toBe('input.items.0.name');
    expect(violations.at(0)?.constraints).toEqual(['name must be a string']);
  });

  it('erzeugt keine Verletzung für eine Ebene ohne eigene constraints, verarbeitet aber ihre children', () => {
    const errors: ValidationError[] = [
      buildValidationError({
        property: 'input',
        constraints: undefined,
        children: [
          buildValidationError({
            property: 'content',
            constraints: { isNotEmpty: 'content should not be empty' },
          }),
        ],
      }),
    ];

    const result = createValidationException(errors);

    const violations = result.details?.violations as ValidationViolation[];
    expect(violations).toHaveLength(1);
    expect(violations.at(0)?.path).toBe('input.content');
  });

  it('gibt eine leere Verletzungsliste für eine leere Eingabe zurück', () => {
    const result = createValidationException([]);

    expect(result).toBeInstanceOf(SentenzaError);
    expect(result.code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
    expect(result.details?.violations).toEqual([]);
  });
});
