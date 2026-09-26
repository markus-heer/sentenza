import type { PayloadKind } from '@sentenza/domain';
import type { z, ZodTypeAny } from 'zod';

import { PayloadSchemaError } from './payload-schema.error.js';

/**
 * Liest einen rohen Payload-Inhalt und validiert ihn vollständig gegen das
 * Schema seiner Payload-Art (Requirement 6.1).
 *
 * Eingabe ist bewusst die **Zeichenkette** aus dem Raw_Payload_Store und kein
 * bereits dekodiertes Objekt: So liegt die JSON-Dekodierung an derselben Stelle
 * wie die Schemaprüfung, und ein nicht lesbarer Inhalt erzeugt denselben
 * Fehlertyp wie eine Schemaverletzung — mit Payload-Art und Pfad `(Wurzel)`.
 *
 * Wirft `PayloadSchemaError`, bevor ein Aufrufer mit dem Ergebnis arbeiten
 * kann; damit kann kein Datensatz des normalisierten Datenmodells aus einem
 * schemawidrigen Payload entstehen (Requirement 6.2).
 */
export function parsePayload<TSchema extends ZodTypeAny>(
  payloadKind: PayloadKind,
  schema: TSchema,
  raw: string,
): z.infer<TSchema> {
  let decoded: unknown;

  try {
    decoded = JSON.parse(raw);
  } catch (cause) {
    throw PayloadSchemaError.fromInvalidJson(payloadKind, cause);
  }

  const result = schema.safeParse(decoded);

  if (!result.success) {
    throw PayloadSchemaError.fromZodError(payloadKind, result.error);
  }

  return result.data;
}
