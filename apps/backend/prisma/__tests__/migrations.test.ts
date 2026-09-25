import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { describe, it } from 'vitest';

const execFileAsync = promisify(execFile);

/**
 * Migrationstreue (Requirement 1.10): ein Lauf der eingecheckten Migrationen
 * auf einer leeren Datenbank muss denselben Stand ergeben wie `schema.prisma`.
 *
 * `global-setup.ts` führt `prisma migrate deploy` gegen `TEST_DATABASE_URL`
 * bereits vor jedem Testlauf dieses Pakets aus (Requirement 10.7) — die
 * Testdatenbank war zu diesem Zeitpunkt leer, `migrate deploy` hat sie also
 * bereits "auf einer leeren Datenbank" aufgebaut. Dieser Test prüft
 * anschließend, dass `prisma migrate diff` zwischen diesem migrierten Stand
 * und `schema.prisma` keine Abweichung findet.
 *
 * `--exit-code` ändert die Exit-Code-Bedeutung von Erfolg/Fehler (0/1) auf
 * leer/nicht-leer/Fehler (0/2/1): 0 = keine Abweichung, 2 = Abweichung
 * gefunden, 1 = Fehler bei der Ausführung selbst.
 */
describe('Migrationstreue', () => {
  it('migrate diff zwischen der migrierten Testdatenbank und schema.prisma ist leer', async () => {
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL ist nicht gesetzt. Dieser Test prüft die Migrationstreue gegen ' +
          'die Testdatenbank und darf nicht ohne sie laufen.',
      );
    }

    try {
      await execFileAsync(
        'pnpm',
        [
          'exec',
          'prisma',
          'migrate',
          'diff',
          '--from-url',
          testDatabaseUrl,
          '--to-schema-datamodel',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        { cwd: new URL('../..', import.meta.url).pathname },
      );
    } catch (error) {
      const { stdout, stderr, code } = error as {
        stdout?: string;
        stderr?: string;
        code?: number;
      };
      throw new Error(
        `prisma migrate diff meldete eine Abweichung zwischen der migrierten Testdatenbank ` +
          `und schema.prisma (Exit-Code ${code}). Das bedeutet, die eingecheckten Migrationen ` +
          `ergeben nicht mehr denselben Stand wie schema.prisma (Requirement 1.10). ` +
          `Ausgabe von prisma migrate diff:\n${stdout ?? ''}\n${stderr ?? ''}`,
      );
    }
  });
});
