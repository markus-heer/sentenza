import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  catalogPayloadSchema,
  grammarTopicSchema,
  parseCatalogPayload,
} from '../catalog-payload.schema.js';
import { PayloadSchemaError } from '../payload-schema.error.js';

/**
 * Das unveränderte Katalog-Fixture ist der Maßstab dafür, dass das Schema die
 * echten Busuu-Daten annimmt (Requirement 10.8). Es wird nur gelesen, nie
 * geschrieben.
 */
const CATALOG_FIXTURE = readFileSync(
  fileURLToPath(new URL('../../../../fixtures/busuu/grammar-review-es.json', import.meta.url)),
  'utf8',
);

/** Kleinster Katalog-Payload, den das Schema annehmen muss. */
const minimalCatalog = {
  id: 'grammar_review_es',
  grammar_categories: [],
};

describe('parseCatalogPayload', () => {
  it('nimmt den unveränderten Katalog-Payload von Busuu vollständig an', () => {
    const payload = parseCatalogPayload(CATALOG_FIXTURE);

    expect(payload.id).toBe('grammar_review_es');
    expect(payload.grammar_categories).toHaveLength(19);
    expect(
      payload.grammar_categories.reduce(
        (count, category) => count + (category.grammar_topics?.length ?? 0),
        0,
      ),
    ).toBe(134);
    expect(Object.keys(payload.translation_map ?? {})).toHaveLength(306);
  });

  it('erhält die von Sentenza nicht abgebildeten Felder der Fremddaten', () => {
    const payload = parseCatalogPayload(CATALOG_FIXTURE);
    const category = payload.grammar_categories[0];

    // Felder, die das normalisierte Modell nicht vorsieht und die Aufgabe 7.6
    // als unbekannte Feldpfade protokolliert (Requirement 6.7). Sie dürfen beim
    // Parsen nicht wegfallen.
    expect(payload['class']).toBe('grammar_review');
    expect(payload['entity_map']).toEqual({});
    expect(category?.content['icon_svg']).toBe(
      'https://cdn.busuu.com/files/icons/grammar/ic_pronouns.svg',
    );
    expect(category?.grammar_topics?.[0]?.['class']).toBe('grammar_topic');
  });

  it('nimmt eine Kategorie ohne structure und ohne grammar_topics an', () => {
    const payload = parseCatalogPayload(
      JSON.stringify({
        ...minimalCatalog,
        grammar_categories: [{ id: 'grammar_category_es_1', content: {} }],
      }),
    );

    expect(payload.grammar_categories[0]?.structure).toBeUndefined();
    expect(payload.grammar_categories[0]?.grammar_topics).toBeUndefined();
  });

  it('nimmt einen Katalog ohne translation_map an, weil dann jedes Inhaltsfeld unaufgelöst bleibt', () => {
    expect(parseCatalogPayload(JSON.stringify(minimalCatalog)).translation_map).toBeUndefined();
  });

  it('bricht mit Payload-Art und Pfad ab, wenn grammar_categories fehlt', () => {
    let caught: unknown;
    try {
      parseCatalogPayload(JSON.stringify({ id: 'grammar_review_es' }));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PayloadSchemaError);
    expect((caught as PayloadSchemaError).path).toBe('grammar_categories');
    expect((caught as PayloadSchemaError).message).toContain('Katalog-Payload');
    expect((caught as PayloadSchemaError).message).toContain('grammar_categories');
  });

  it('benennt den Pfad der ersten verletzten Stelle innerhalb der Verschachtelung', () => {
    const raw = JSON.stringify({
      ...minimalCatalog,
      grammar_categories: [
        {
          id: 'grammar_category_es_1',
          content: {},
          grammar_topics: [{ id: 'grammar_topic_es_1_3', content: {} }, { content: {} }],
        },
      ],
    });

    expect(() => parseCatalogPayload(raw)).toThrow(
      /grammar_categories\[0\]\.grammar_topics\[1\]\.id/,
    );
  });
});

describe('grammarTopicSchema', () => {
  it('nimmt ein Thema ohne Bezeichnung, Beschreibung und Niveau an', () => {
    const result = grammarTopicSchema.safeParse({ id: 'grammar_topic_es_1_3', content: {} });

    expect(result.success).toBe(true);
  });

  it('nimmt level als null an, wie Busuu es für leere Werte liefert', () => {
    const result = grammarTopicSchema.safeParse({
      id: 'grammar_topic_es_1_3',
      content: { level: null },
    });

    expect(result.success).toBe(true);
  });

  it('nimmt eine UUID-basierte Kennung unverändert an', () => {
    const busuuId = 'grammar_topic_3d4fa7b0-ff12-44f1-9d9b-b320e67753de';
    const result = grammarTopicSchema.safeParse({ id: busuuId, content: {} });

    expect(result.success && result.data.id).toBe(busuuId);
  });

  it('weist eine Kennung über 200 Zeichen und eine leere Kennung zurück', () => {
    expect(grammarTopicSchema.safeParse({ id: 'x'.repeat(201), content: {} }).success).toBe(false);
    expect(grammarTopicSchema.safeParse({ id: '', content: {} }).success).toBe(false);
    expect(grammarTopicSchema.safeParse({ id: 'x'.repeat(200), content: {} }).success).toBe(true);
  });
});

describe('catalogPayloadSchema', () => {
  it('validiert ein bereits dekodiertes Objekt, wie es der Serializer erzeugt', () => {
    expect(catalogPayloadSchema.safeParse(minimalCatalog).success).toBe(true);
  });
});
