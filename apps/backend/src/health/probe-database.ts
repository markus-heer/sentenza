/**
 * Zeitlimit der Datenbankprüfung (design.md, Abschnitt "Health-Endpunkt";
 * Requirement 9.8, 9.9). Die Antwort des Endpunkts muss innerhalb von 5
 * Sekunden stehen, also darf die Prüfung selbst nicht länger dauern.
 */
export const DATABASE_PROBE_TIMEOUT_MS = 5_000;

/**
 * Die einzige Fähigkeit, die die Datenbankprüfung vom Prisma-Client braucht.
 *
 * Bewusst so schmal geschnitten: Die Prüfung soll `SELECT 1` ausführen und
 * nichts anderes, und sie ist damit ohne laufende Nest-Anwendung und ohne
 * Datenbank prüfbar. `PrismaService` erfüllt diese Form; dass er es tut, wird
 * an der Erzeugungsstelle in `health.module.ts` vom Type-Check bestätigt.
 */
export interface DatabasePingClient {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
}

/**
 * Grund eines Fehlschlags. `timeout` bedeutet, dass die Datenbank innerhalb
 * des Zeitlimits nicht geantwortet hat; `unreachable` jeden anderen Fehler des
 * Verbindungsaufbaus oder der Abfrage.
 */
export type DatabaseProbeFailureReason = 'timeout' | 'unreachable';

/**
 * Ergebnis einer Datenbankprüfung. `durationMs` steht in beiden Fällen zur
 * Verfügung, damit der Health-Endpunkt die Dauer auch dann nennen kann, wenn
 * die Prüfung fehlgeschlagen ist.
 *
 * `cause` trägt die technische Ursache ausschließlich zur Protokollierung; sie
 * gehört nicht in die Antwort des Endpunkts (Requirement 9.3: keine
 * Datenbankmeldung, kein Dateipfad, kein Hostname nach außen).
 */
export type DatabaseProbeResult =
  | { reachable: true; durationMs: number }
  | {
      reachable: false;
      durationMs: number;
      reason: DatabaseProbeFailureReason;
      cause: string;
    };

/** Eigener Fehlertyp, damit das Zeitlimit vom Abfragefehler unterscheidbar ist. */
class DatabaseProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Datenbankprüfung nach ${timeoutMs} ms abgebrochen`);
    this.name = 'DatabaseProbeTimeoutError';
  }
}

function elapsedMs(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Führt `SELECT 1` über den übergebenen Client aus und meldet, ob die
 * Datenbank erreichbar war (design.md, Abschnitt "Health-Endpunkt";
 * Requirement 9.7, 9.8, 9.9).
 *
 * Die Funktion wirft nicht: Ein Fehlschlag ist hier ein Ergebnis, kein
 * Ausnahmefall — der Health-Endpunkt soll ihn ja gerade berichten.
 *
 * Das Zeitlimit begrenzt die Wartezeit, nicht die Abfrage selbst: Prisma kennt
 * keinen Abbruch einer laufenden Abfrage, die Abfrage läuft also im
 * Hintergrund weiter. Entscheidend für Requirement 9.8 ist, dass die Antwort
 * innerhalb von 5 Sekunden steht, und das leistet `Promise.race`. Die
 * Ablehnung der Abfrage bleibt dabei behandelt, weil `Promise.race` an beide
 * Versprechen einen Handler hängt.
 */
export async function probeDatabase(
  client: DatabasePingClient,
  timeoutMs: number = DATABASE_PROBE_TIMEOUT_MS,
): Promise<DatabaseProbeResult> {
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DatabaseProbeTimeoutError(timeoutMs)), timeoutMs);
      }),
    ]);

    return { reachable: true, durationMs: elapsedMs(startedAt) };
  } catch (error) {
    return {
      reachable: false,
      durationMs: elapsedMs(startedAt),
      reason: error instanceof DatabaseProbeTimeoutError ? 'timeout' : 'unreachable',
      cause: describeCause(error),
    };
  } finally {
    // Ohne dies hielte der noch offene Timer den Prozess bis zum Ablauf des
    // Zeitlimits wach, auch wenn die Abfrage längst geantwortet hat.
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
