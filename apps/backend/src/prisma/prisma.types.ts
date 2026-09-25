// Einziger Ort im Backend, der aus dem generierten Prisma-Client importiert
// (Requirement 1.10: "Der generierte Client wird ausschließlich über
// src/prisma/prisma.types.ts re-exportiert."). Jeder andere Konsument
// importiert von hier, nie direkt aus `@prisma/client`.

import { Prisma, PrismaClient } from '@prisma/client';

export { Prisma, PrismaClient };

export type {
  CefrLevel,
  GrammarCategory,
  GrammarProgress,
  GrammarTopic,
  PayloadKind,
  ProcessingState,
  RawPayload,
  RefreshToken,
  SubmissionSource,
  TargetLanguage,
  UserAccount,
} from '@prisma/client';

/**
 * Der transaktionale Client, den `prisma.$transaction(async (tx) => ...)`
 * an seinen Callback übergibt. Normalizer und Ingestion-Service nehmen diesen
 * Typ als Parameter entgegen, statt selbst `PrismaClient` zu importieren
 * (siehe design.md, `BusuuNormalizer.normalizeCatalog(raw, ctx, tx: PrismaTx)`).
 */
export type PrismaTx = Prisma.TransactionClient;

/**
 * Die von Prisma erzeugte Modellbeschreibung (DMMF). `Prisma.dmmf.datamodel.models`
 * liefert je Modell aus `schema.prisma` unter anderem `name` und `dbName`; ohne
 * `@@map` im Schema entspricht der Tabellenname dem Modellnamen. Genutzt vom
 * Reset-Helfer der Testdatenbank (`test/reset-database.ts`), damit ein neues
 * Modell dort nicht händisch nachgetragen werden muss.
 */
export const dmmf = Prisma.dmmf;
