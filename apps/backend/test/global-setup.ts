import { execFileSync } from 'node:child_process';

/**
 * Vitest-`globalSetup` für datenbankgestützte Backend-Tests (Requirement 10.7).
 *
 * Läuft genau einmal vor allen Tests dieses Vitest-Prozesses, nicht vor jedem
 * einzelnen Test. Zwei Aufgaben, in dieser Reihenfolge:
 *
 * 1. Abbruch, wenn keine `TEST_DATABASE_URL` konfiguriert ist oder sie mit
 *    `DATABASE_URL` übereinstimmt. Das ist die Schranke gegen ein versehentliches
 *    `TRUNCATE` der echten Entwicklungsdatenbank durch den Reset-Helfer
 *    (`reset-database.ts`), der vor jedem Test läuft.
 * 2. `prisma migrate deploy` gegen genau diese Testdatenbank, damit der
 *    Ausgangszustand vor dem ersten Test vollständig migriert ist. Die
 *    Prisma-CLI liest die Verbindung ausschließlich aus `DATABASE_URL`
 *    (`env("DATABASE_URL")` in `schema.prisma`); deshalb wird `DATABASE_URL`
 *    nur in der Umgebung dieses einen Subprozesses auf den Wert von
 *    `TEST_DATABASE_URL` gesetzt, die Umgebung des Testprozesses selbst bleibt
 *    unverändert.
 */
export default function setup(): void {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (!testDatabaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL ist nicht gesetzt. Datenbankgestützte Tests dürfen nicht ohne ' +
        'ausdrücklich konfigurierte Testdatenbank laufen.',
    );
  }

  if (testDatabaseUrl === databaseUrl) {
    throw new Error(
      'TEST_DATABASE_URL ist identisch zu DATABASE_URL. Das würde die Entwicklungsdatenbank ' +
        'beim Testlauf zurücksetzen; Abbruch vor jedem Testzugriff.',
    );
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'inherit',
  });
}
