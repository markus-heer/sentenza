import { describe, expect, it } from 'vitest';

import { translationEntrySchema, translationMapSchema } from '../translation-map.schema.js';

/**
 * Prüfungen der Übersetzungskarte (Requirement 6.1, 4.6, 4.7).
 *
 * Die Schemata selbst entscheiden nicht über die Auflösung — sie legen nur fest,
 * welche Gestalt ein Eintrag haben darf. Der Schwerpunkt liegt deshalb darauf,
 * dass jede von Busuu gelieferte Form zugelassen wird und `.passthrough()`
 * unbekannte Felder erhält.
 */
describe('translationEntrySchema', () => {
  it('nimmt einen Eintrag mit value an', () => {
    const result = translationEntrySchema.safeParse({ value: 'Pronomen' });

    expect(result.success).toBe(true);
  });

  it('nimmt einen Eintrag mit leerem value und alternative_values an', () => {
    const result = translationEntrySchema.safeParse({
      value: '',
      alternative_values: ['', 'Ersatzform'],
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.alternative_values).toEqual(['', 'Ersatzform']);
  });

  it('nimmt einen leeren Eintrag an, weil ein unaufgelöstes Inhaltsfeld vorgesehen ist', () => {
    const result = translationEntrySchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('erhält unbekannte Felder, statt sie abzuschneiden', () => {
    const result = translationEntrySchema.safeParse({ value: 'x', audio: 'https://cdn/x.mp3' });

    expect(result.success && result.data).toEqual({ value: 'x', audio: 'https://cdn/x.mp3' });
  });

  it('weist einen value zurück, der keine Zeichenkette ist', () => {
    const result = translationEntrySchema.safeParse({ value: 42 });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['value']);
  });
});

describe('translationMapSchema', () => {
  it('nimmt eine Karte mit mehreren Schlüsseln und Sprachen an', () => {
    const result = translationMapSchema.safeParse({
      str_a: { de: { value: 'Pronomen' }, en: { value: 'Pronouns' } },
      str_b: { de: {}, en: { value: '' }, fr: { value: 'Pronoms' } },
    });

    expect(result.success).toBe(true);
    expect(result.success && Object.keys(result.data)).toEqual(['str_a', 'str_b']);
  });

  it('nimmt eine leere Karte an', () => {
    expect(translationMapSchema.safeParse({}).success).toBe(true);
  });

  it('weist eine Karte zurück, deren Sprachzuordnung kein Objekt ist', () => {
    const result = translationMapSchema.safeParse({ str_a: 'Pronomen' });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['str_a']);
  });
});
