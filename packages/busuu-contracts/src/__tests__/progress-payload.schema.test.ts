import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PayloadSchemaError } from '../payload-schema.error.js';
import { parseProgressPayload, progressPayloadSchema } from '../progress-payload.schema.js';

/** Das unveränderte Lernstands-Fixture von Busuu (Requirement 10.8), nur lesend verwendet. */
const PROGRESS_FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../../fixtures/busuu/progress.json', import.meta.url)),
  'utf8',
);

describe('parseProgressPayload', () => {
  it('nimmt den unveränderten Lernstands-Payload von Busuu vollständig an', () => {
    const payload = parseProgressPayload(PROGRESS_FIXTURE);

    expect(payload.status).toBe('ok');
    expect(payload.data).toHaveLength(8);
    expect(payload.data[4]).toEqual({
      topic_id: 'grammar_topic_es_1_3',
      strength: 3,
      percentage: 90,
    });
  });

  it('nimmt eine leere data-Liste an, weil sie bestehende Lernstände unberührt lässt', () => {
    expect(parseProgressPayload(JSON.stringify({ status: 'ok', data: [] })).data).toEqual([]);
  });

  it('nimmt Einträge an, die der Normalizer einzeln verwerfen muss', () => {
    // Requirement 5.5, 5.6 und 5.10 verlangen das Verwerfen des **einzelnen**
    // Eintrags bei fortgesetzter Verarbeitung. Das Schema darf den Payload
    // deshalb nicht abweisen, sonst ginge auch der gültige Eintrag verloren.
    const payload = parseProgressPayload(
      JSON.stringify({
        status: 'ok',
        data: [
          {},
          { topic_id: '' },
          { topic_id: 'a', strength: 3 },
          { topic_id: 'b', strength: 3, percentage: 101 },
          { topic_id: 'c', strength: 3, percentage: 42.5 },
          { topic_id: 'd', strength: -1, percentage: 50 },
          { topic_id: 'e', strength: 0, percentage: 0 },
        ],
      }),
    );

    expect(payload.data).toHaveLength(7);
  });

  it('nimmt einen von ok abweichenden status an, damit der Normalizer ihn benennen kann', () => {
    // Requirement 5.12: Der Abbruch mit Nennung des abweichenden Werts gehört in
    // den Normalizer; im Schema abgebildet käme der Wert dort nie an.
    expect(parseProgressPayload(JSON.stringify({ status: 'error', data: [] })).status).toBe(
      'error',
    );
  });

  it('erhält unbekannte Felder eines Eintrags', () => {
    const payload = parseProgressPayload(
      JSON.stringify({ status: 'ok', data: [{ topic_id: 'a', updated_at: 1_700_000_000 }] }),
    );

    expect(payload.data[0]?.['updated_at']).toBe(1_700_000_000);
  });

  it('bricht mit Payload-Art und Pfad ab, wenn data fehlt', () => {
    let caught: unknown;
    try {
      parseProgressPayload(JSON.stringify({ status: 'ok' }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadSchemaError);
    expect((caught as PayloadSchemaError).path).toBe('data');
    expect((caught as PayloadSchemaError).message).toContain('Lernstands-Payload');
  });

  it('benennt den Index des ersten unbrauchbaren Eintrags', () => {
    const raw = JSON.stringify({
      status: 'ok',
      data: [{ topic_id: 'a' }, { topic_id: 17 }],
    });

    expect(() => parseProgressPayload(raw)).toThrow(/data\[1\]\.topic_id/);
  });
});

describe('progressPayloadSchema', () => {
  it('validiert ein bereits dekodiertes Objekt, wie es der Serializer erzeugt', () => {
    expect(progressPayloadSchema.safeParse({ status: 'ok', data: [] }).success).toBe(true);
  });
});
