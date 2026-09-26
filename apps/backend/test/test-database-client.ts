import { PrismaClient } from '../src/prisma/prisma.types.js';

/**
 * Ein Prisma-Client, der ausdrücklich auf die Testdatenbank zeigt
 * (design.md, Abschnitt "Testdatenbank"; Requirement 10.7).
 *
 * Die Verbindung wird über `datasourceUrl` gesetzt statt über die Umgebung:
 * `schema.prisma` liest `env("DATABASE_URL")`, und ein Test soll die Umgebung
 * des Testprozesses nicht umschreiben müssen, um nicht versehentlich die
 * Entwicklungsdatenbank zu treffen.
 *
 * Die beiden Schranken aus `global-setup.ts` stehen hier ein zweites Mal — dort
 * einmal vor allen Tests, hier an jeder Verbindungsstelle. Das ist Absicht:
 * `reset-database.ts` führt ein `TRUNCATE` über alle Tabellen aus, und der
 * Preis eines Fehlgriffs ist der Verlust des Entwicklungsbestands. Die Prüfung
 * kostet nichts und greift auch dann, wenn ein Test einmal ohne das
 * Global-Setup läuft.
 *
 * Aufrufer sind für `$disconnect()` zuständig, üblicherweise aus einem
 * `afterAll`.
 */
export function createTestDatabaseClient(): PrismaClient {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL ist nicht gesetzt. Datenbankgestützte Tests dürfen nicht ohne ' +
        'ausdrücklich konfigurierte Testdatenbank laufen.',
    );
  }

  if (testDatabaseUrl === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL ist identisch zu DATABASE_URL. Das würde die Entwicklungsdatenbank ' +
        'beim Testlauf zurücksetzen; Abbruch vor jedem Datenbankzugriff.',
    );
  }

  return new PrismaClient({ datasourceUrl: testDatabaseUrl });
}
