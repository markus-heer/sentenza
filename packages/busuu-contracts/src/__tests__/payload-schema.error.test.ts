import { PayloadKind } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';
import { z, ZodError } from 'zod';

import { PayloadSchemaError } from '../payload-schema.error.js';

describe('PayloadSchemaError', () => {
  it('nennt Payload-Art, Pfad und Grund in der Meldung', () => {
    const error = new PayloadSchemaError(
      PayloadKind.CATALOG,
      'grammar_categories[0].id',
      'Required',
    );

    expect(error.message).toBe(
      'Katalog-Payload verletzt das Schema an der Stelle grammar_categories[0].id: Required',
    );
    expect(error.name).toBe('PayloadSchemaError');
    expect(error instanceof Error).toBe(true);
  });

  it('bildet Array-Indizes des Zod-Pfads in eckigen Klammern ab', () => {
    const schema = z.object({
      grammar_categories: z.array(
        z.object({ grammar_topics: z.array(z.object({ id: z.string() })) }),
      ),
    });
    const result = schema.safeParse({ grammar_categories: [{ grammar_topics: [{}] }] });
    const error = PayloadSchemaError.fromZodError(
      PayloadKind.CATALOG,
      result.success ? new ZodError([]) : result.error,
    );

    expect(error.path).toBe('grammar_categories[0].grammar_topics[0].id');
    expect(error.payloadKind).toBe(PayloadKind.CATALOG);
  });

  it('benennt ausschließlich die erste von mehreren Verletzungen', () => {
    const schema = z.object({ status: z.string(), data: z.array(z.unknown()) });
    const result = schema.safeParse({});
    const error = PayloadSchemaError.fromZodError(
      PayloadKind.PROGRESS,
      result.success ? new ZodError([]) : result.error,
    );

    expect(error.path).toBe('status');
    expect(error.message).toContain('Lernstands-Payload');
    expect(error.message).not.toContain('data');
  });

  it('weist einen ZodError ohne Verletzungen der Wurzel zu', () => {
    const error = PayloadSchemaError.fromZodError(PayloadKind.PROGRESS, new ZodError([]));

    expect(error.path).toBe('(Wurzel)');
    expect(error.reason).toBe('unbekannte Schemaverletzung');
  });

  it('bildet einen nicht als JSON lesbaren Inhalt auf die Wurzel ab', () => {
    const error = PayloadSchemaError.fromInvalidJson(
      PayloadKind.CATALOG,
      new SyntaxError('Unexpected end of JSON input'),
    );

    expect(error.path).toBe('(Wurzel)');
    expect(error.message).toContain('Unexpected end of JSON input');
  });

  it('bildet eine Ursache ohne Error-Gestalt auf eine eigene Begründung ab', () => {
    const error = PayloadSchemaError.fromInvalidJson(PayloadKind.PROGRESS, 'kaputt');

    expect(error.reason).toBe('Inhalt ist kein gültiges JSON');
  });
});
