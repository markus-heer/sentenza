import { z } from 'zod';

/**
 * Ein Eintrag der Übersetzungskarte für genau eine Sprache.
 *
 * Busuu liefert den Klartext unter `value`; fehlt er oder ist er leer, kann
 * unter `alternative_values` mindestens ein Ersatzwert stehen (Requirement
 * 4.7). Beide Felder sind optional, weil beide fehlen dürfen — in diesem Fall
 * bleibt das Inhaltsfeld unaufgelöst (Requirement 4.6). Die Auflösungsregel
 * selbst gehört nicht in das Schema, sondern in `resolveText` (Aufgabe 7.2).
 *
 * `.passthrough()`: Unbekannte Felder der Fremddaten bleiben erhalten, damit
 * sie protokolliert werden können (Requirement 6.7) und die rohen Payloads
 * nicht durch das Parsen beschnitten werden.
 */
export const translationEntrySchema = z
  .object({
    value: z.string().optional(),
    alternative_values: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Die Sprachzuordnung eines Übersetzungsschlüssels: Sprach-Code auf Eintrag.
 *
 * Bewusst als offener Record und nicht als Objekt mit den Feldern `de` und
 * `en` deklariert: Im vorliegenden Katalog-Fixture liefert Busuu genau diese
 * zwei Sprachen, eine dritte Sprache soll das Schema aber nicht verletzen.
 * Welche Sprachen Sentenza auflöst, entscheidet `resolveText` (Aufgabe 7.2),
 * nicht das Schema.
 */
export const translationLanguageMapSchema = z.record(z.string(), translationEntrySchema);

/**
 * Die Übersetzungskarte eines Katalog-Payloads: Übersetzungsschlüssel (Präfix
 * `str_`) auf Sprachzuordnung.
 */
export const translationMapSchema = z.record(z.string(), translationLanguageMapSchema);

/** Eintrag der Übersetzungskarte für eine Sprache, abgeleitet aus dem Schema. */
export type TranslationEntry = z.infer<typeof translationEntrySchema>;

/** Sprachzuordnung eines Übersetzungsschlüssels, abgeleitet aus dem Schema. */
export type TranslationLanguageMap = z.infer<typeof translationLanguageMapSchema>;

/** Übersetzungskarte eines Katalog-Payloads, abgeleitet aus dem Schema. */
export type TranslationMap = z.infer<typeof translationMapSchema>;
