import { PrismaClient } from '../prisma/prisma.types.js';

const RETRY_DELAY_MS = 500;

/**
 * Maskiert das Zugangsdatum in einer PostgreSQL-Verbindungszeichenkette,
 * sodass eine Fehlermeldung `host:port/database` zeigt, aber nicht
 * `user:password` (Requirement 9.5: Zugangsdaten sind von der Protokollierung
 * ausgenommen; dieselbe Vorsicht gilt für Fehlermeldungen beim Start).
 */
function maskDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '(unlesbare Verbindungszeichenkette)';
  }
}

/**
 * Wartet, bis die konfigurierte PostgreSQL-Instanz Verbindungen annimmt, oder
 * bricht nach `timeoutMs` ab (Requirement 1.12, design.md Abschnitt
 * "Startprüfungen": Frist aus `DB_STARTUP_TIMEOUT_MS`, Vorgabe 60.000 ms).
 *
 * Verwendet einen eigenen, kurzlebigen `PrismaClient` statt `PrismaService`,
 * weil zu diesem Zeitpunkt noch keine Nest-Anwendung existiert. Der
 * Verbindungsversuch wird in jedem Fall — Erfolg oder endgültiger
 * Fehlschlag — wieder geschlossen, damit kein offenes Handle in den
 * anschließenden `NestFactory.create`-Aufruf hineinläuft.
 */
export async function waitForDatabase(databaseUrl: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    const client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      await client.$connect();
      await client.$disconnect();
      return;
    } catch (error) {
      lastError = error;
      await client.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  const cause = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Datenbank unter ${maskDatabaseUrl(databaseUrl)} war nach ${timeoutMs} ms nicht erreichbar: ${cause}`,
  );
}
