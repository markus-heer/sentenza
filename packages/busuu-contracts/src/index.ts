/**
 * @sentenza/busuu-contracts — die Zod-Schemata der beiden Busuu-Payload-Arten
 * und die reine, datenbankfreie Auflösungslogik darauf.
 *
 * Das Paket ist ausdrücklich frei von NestJS und Prisma, damit Normalizer,
 * Serializer und Testgeneratoren dieselbe Schemadefinition benutzen und ohne
 * Datenbank prüfbar sind (design.md, Abschnitt "Workspace-Struktur"). Geteilte
 * Enumerationen kommen aus `@sentenza/domain` und werden hier nicht erneut
 * deklariert (Requirement 1.4).
 */

export {
  type CatalogPayload,
  catalogPayloadSchema,
  type GrammarCategoryPayload,
  grammarCategorySchema,
  type GrammarTopicPayload,
  grammarTopicSchema,
  parseCatalogPayload,
} from './catalog-payload.schema.js';
export { parsePayload } from './parse-payload.js';
export { PayloadSchemaError } from './payload-schema.error.js';
export {
  parseProgressPayload,
  type ProgressEntryPayload,
  progressEntrySchema,
  type ProgressPayload,
  progressPayloadSchema,
} from './progress-payload.schema.js';
export {
  type TranslationEntry,
  translationEntrySchema,
  type TranslationLanguageMap,
  translationLanguageMapSchema,
  type TranslationMap,
  translationMapSchema,
} from './translation-map.schema.js';

// Anschlussstellen der Folgeaufgaben dieser Spur. Die Module entstehen dort,
// die Exportzeilen gehören unverändert an diese Stelle:
//
// Aufgabe 7.2 — Auflösung der Übersetzungsschlüssel (Requirement 4.5–4.7, 4.10):
//   export { resolveText, type ResolvedText } from './resolve-text.js';
//
// Aufgabe 7.4 — CEFR-Abbildung (Requirement 4.8, 4.9):
//   export { mapCefrLevel, type MappedCefrLevel } from './map-cefr-level.js';
//
// Aufgabe 7.6 — Erkennung unbekannter Feldpfade (Requirement 6.7):
//   export { collectUnknownPaths } from './collect-unknown-paths.js';
