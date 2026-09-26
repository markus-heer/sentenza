import { PayloadKind } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parsePayload } from '../parse-payload.js';
import { PayloadSchemaError } from '../payload-schema.error.js';

/** Stellvertreterschema; die echten Schemata prüfen ihre eigenen Testdateien. */
const probeSchema = z.object({ id: z.string().min(1) }).passthrough();

describe('parsePayload', () => {
  it('dekodiert den rohen Inhalt und gibt das validierte Objekt zurück', () => {
    const parsed = parsePayload(PayloadKind.CATALOG, probeSchema, '{"id":"a","extra":true}');

    expect(parsed).toEqual({ id: 'a', extra: true });
  });

  it('bricht bei nicht lesbarem JSON an der Wurzel ab und nennt die Payload-Art', () => {
    let caught: unknown;
    try {
      parsePayload(PayloadKind.PROGRESS, probeSchema, '{"id":');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadSchemaError);
    expect((caught as PayloadSchemaError).payloadKind).toBe(PayloadKind.PROGRESS);
    expect((caught as PayloadSchemaError).path).toBe('(Wurzel)');
    expect((caught as PayloadSchemaError).message).toContain('Lernstands-Payload');
  });

  it('bricht bei einer Schemaverletzung mit dem Pfad der ersten verletzten Stelle ab', () => {
    let caught: unknown;
    try {
      parsePayload(PayloadKind.CATALOG, probeSchema, '{"id":""}');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadSchemaError);
    expect((caught as PayloadSchemaError).payloadKind).toBe(PayloadKind.CATALOG);
    expect((caught as PayloadSchemaError).path).toBe('id');
  });

  it('bricht bei leerem Inhalt ab, statt undefined zurückzugeben', () => {
    expect(() => parsePayload(PayloadKind.CATALOG, probeSchema, '')).toThrow(PayloadSchemaError);
  });

  it('bricht ab, wenn der Inhalt zwar gültiges JSON, aber kein Objekt ist', () => {
    let caught: unknown;
    try {
      parsePayload(PayloadKind.CATALOG, probeSchema, '[]');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadSchemaError);
    expect((caught as PayloadSchemaError).path).toBe('(Wurzel)');
  });
});
