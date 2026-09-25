import { dmmf, type PrismaClient, type PrismaTx } from '../src/prisma/prisma.types.js';

/**
 * Setzt den Bestand der Testdatenbank auf leer zurück: ein einziges
 * `TRUNCATE … RESTART IDENTITY CASCADE` über alle Tabellen, deren Namen aus
 * der Prisma-DMMF abgeleitet werden (Requirement 10.7). Weil die Tabellenmenge
 * nicht fest im Code steht, sondern aus `schema.prisma` über die DMMF gelesen
 * wird, vergisst der Reset kein neu hinzugefügtes Modell.
 *
 * Bewusst eine gewöhnliche, explizit aufrufbare Funktion und kein Vitest-Hook:
 * spätere eigenschaftsbasierte Tests rufen sie innerhalb eines `fc`-Durchlaufs
 * selbst auf (einmal je der mindestens 100 Durchläufe), damit die Durchläufe
 * voneinander unabhängig sind. Gewöhnliche Tests verwenden sie stattdessen aus
 * einem `beforeEach`.
 *
 * `$executeRawUnsafe` ist hier unbedenklich: die eingesetzten Bezeichner
 * stammen ausschließlich aus der Prisma-DMMF, nicht aus Nutzereingaben. Jeder
 * Bezeichner wird trotzdem doppelt gequotet, als Verteidigung in der Tiefe.
 */
export async function resetDatabase(prisma: PrismaClient | PrismaTx): Promise<void> {
  const tableNames = getTableNames();
  if (tableNames.length === 0) {
    return;
  }

  const quotedTableNames = tableNames.map((tableName) => `"${tableName}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quotedTableNames} RESTART IDENTITY CASCADE;`);
}

/**
 * Die Tabellennamen aller Modelle aus `schema.prisma`. Ohne `@@map` im Schema
 * entspricht der Tabellenname dem Modellnamen (`dbName === null`); ein
 * gesetztes `dbName` hätte Vorrang, falls ein Modell künftig gemappt wird.
 */
function getTableNames(): string[] {
  return dmmf.datamodel.models.map((model) => model.dbName ?? model.name);
}
