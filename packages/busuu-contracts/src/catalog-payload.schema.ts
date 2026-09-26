import { PayloadKind } from '@sentenza/domain';
import { z } from 'zod';

import { parsePayload } from './parse-payload.js';
import { translationMapSchema } from './translation-map.schema.js';

/** Längengrenze der Busuu-Kennungen, die unverändert als fachlicher Schlüssel dienen (Requirement 4.4). */
const BUSUU_ID_MAX_LENGTH = 200;

/**
 * Ein Grammatik_Thema im Katalog-Payload.
 *
 * Gefordert ist ausschließlich, was die Normalisierung braucht: die Busuu-
 * Kennung (1–200 Zeichen, sowohl `grammar_topic_es_1_3` als auch UUID-basiert,
 * Requirement 4.4) und das Objekt `content`. `name`, `description` und `level`
 * dürfen fehlen — das Niveau wird dann auf `UNBEKANNT` abgebildet (Requirement
 * 4.9), die Inhaltsfelder bleiben unaufgelöst (Requirement 4.6). `level` ist
 * `nullish`, weil Busuu leere Werte als `null` liefert.
 */
export const grammarTopicSchema = z
  .object({
    id: z.string().min(1).max(BUSUU_ID_MAX_LENGTH),
    premium: z.boolean().optional(),
    access_tier: z.string().optional(),
    content: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        level: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Eine Grammatik_Kategorie im Katalog-Payload.
 *
 * `structure` und `grammar_topics` sind optional, weil der Katalog beide Seiten
 * auseinanderlaufen lassen darf: eine Kennung in `structure` ohne Objekt unter
 * `grammar_topics` (Requirement 4.12) und ein Objekt unter `grammar_topics`, das
 * in keiner `structure` referenziert wird (Requirement 4.17). Ein fehlendes Feld
 * ist der Grenzfall dieser beiden Fälle und darf den Payload nicht verwerfen.
 */
export const grammarCategorySchema = z
  .object({
    id: z.string().min(1).max(BUSUU_ID_MAX_LENGTH),
    premium: z.boolean().optional(),
    content: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough(),
    structure: z.array(z.string()).optional(),
    grammar_topics: z.array(grammarTopicSchema).optional(),
  })
  .passthrough();

/**
 * Katalog-Payload: der Grammatik_Katalog einer Zielsprache.
 *
 * `id` ist gefordert, weil die Zielsprache aus dem Segment hinter dem letzten
 * Unterstrich dieser Kennung abgeleitet wird (Requirement 4.1). `translation_map`
 * ist optional: Fehlt sie vollständig, bleibt jedes Inhaltsfeld unaufgelöst,
 * was Requirement 4.6 ausdrücklich vorsieht.
 *
 * Alle Objektschemata dieses Pakets nutzen durchgehend `.passthrough()`, damit
 * unbekannte Felder der Fremddaten beim Parsen nicht wegfallen. Sie sind für die
 * Protokollierung unbekannter Feldpfade nötig (Requirement 6.7) und würden sonst
 * zwischen dem unverändert aufbewahrten Rohinhalt und dem geparsten Objekt
 * auseinanderlaufen.
 */
export const catalogPayloadSchema = z
  .object({
    id: z.string().min(1),
    grammar_categories: z.array(grammarCategorySchema),
    translation_map: translationMapSchema.optional(),
  })
  .passthrough();

/** Grammatik_Thema eines Katalog-Payloads, abgeleitet aus dem Schema. */
export type GrammarTopicPayload = z.infer<typeof grammarTopicSchema>;

/** Grammatik_Kategorie eines Katalog-Payloads, abgeleitet aus dem Schema. */
export type GrammarCategoryPayload = z.infer<typeof grammarCategorySchema>;

/** Katalog-Payload, abgeleitet aus dem Schema. */
export type CatalogPayload = z.infer<typeof catalogPayloadSchema>;

/**
 * Liest einen rohen Katalog-Payload und validiert ihn vollständig, bevor der
 * Aufrufer den ersten Datensatz anlegen kann (Requirement 6.1).
 *
 * Wirft `PayloadSchemaError`; die Meldung nennt die Payload-Art und den Pfad der
 * ersten verletzten Stelle (Requirement 6.2).
 */
export function parseCatalogPayload(raw: string): CatalogPayload {
  return parsePayload(PayloadKind.CATALOG, catalogPayloadSchema, raw);
}
