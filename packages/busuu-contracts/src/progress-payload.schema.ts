import { PayloadKind } from '@sentenza/domain';
import { z } from 'zod';

import { parsePayload } from './parse-payload.js';

/**
 * Ein Lernstands-Eintrag unter `data`.
 *
 * Alle drei Felder sind optional und ohne Wertebereich deklariert. Das ist
 * Absicht: Ein fehlendes `topic_id` (Requirement 5.10), ein fehlender oder
 * nicht ganzzahliger `percentage` außerhalb von 0–100 (Requirement 5.5) und
 * eine fehlende oder negative `strength` (Requirement 5.6) führen zum
 * **Verwerfen des einzelnen Eintrags** bei fortgesetzter Verarbeitung der
 * übrigen. Wären diese Bedingungen im Schema abgebildet, würde stattdessen der
 * gesamte Payload abgewiesen und kein einziger gültiger Eintrag persistiert.
 */
export const progressEntrySchema = z
  .object({
    topic_id: z.string().optional(),
    strength: z.number().optional(),
    percentage: z.number().optional(),
  })
  .passthrough();

/**
 * Lernstands-Payload: der Lernstand je Grammatik_Thema.
 *
 * `status` ist gefordert, weil ein von `ok` abweichender Wert die Verarbeitung
 * abbricht und in der Fehlermeldung genannt werden muss (Requirement 5.12);
 * diese Prüfung gehört in den Normalizer, nicht in das Schema, damit der
 * abweichende Wert überhaupt bis dorthin gelangt. `data` darf eine leere Liste
 * sein (Requirement 5.9).
 */
export const progressPayloadSchema = z
  .object({
    status: z.string(),
    data: z.array(progressEntrySchema),
  })
  .passthrough();

/** Lernstands-Eintrag eines Lernstands-Payloads, abgeleitet aus dem Schema. */
export type ProgressEntryPayload = z.infer<typeof progressEntrySchema>;

/** Lernstands-Payload, abgeleitet aus dem Schema. */
export type ProgressPayload = z.infer<typeof progressPayloadSchema>;

/**
 * Liest einen rohen Lernstands-Payload und validiert ihn vollständig, bevor der
 * Aufrufer den ersten Datensatz anlegen kann (Requirement 6.1).
 *
 * Wirft `PayloadSchemaError`; die Meldung nennt die Payload-Art und den Pfad der
 * ersten verletzten Stelle (Requirement 6.2).
 */
export function parseProgressPayload(raw: string): ProgressPayload {
  return parsePayload(PayloadKind.PROGRESS, progressPayloadSchema, raw);
}
