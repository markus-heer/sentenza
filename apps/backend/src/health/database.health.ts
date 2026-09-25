import { HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';

import { createLogger, SentenzaLogger } from '../common/logger.js';
import {
  DATABASE_PROBE_TIMEOUT_MS,
  DatabasePingClient,
  DatabaseProbeFailureReason,
  probeDatabase,
} from './probe-database.js';

/**
 * Name der geprüften Abhängigkeit in der Antwort des Health-Endpunkts
 * (design.md, Abschnitt "Health-Endpunkt"). Requirement 9.9 verlangt, dass die
 * nicht erreichbare Abhängigkeit benannt wird — dieser Schlüssel benennt sie.
 */
export const DATABASE_INDICATOR_KEY = 'database';

/**
 * Meldung, die nach außen geht. Bewusst fest formuliert und ohne technische
 * Ursache: Die Antwort des Endpunkts enthält keine Datenbankmeldung, keinen
 * Dateipfad und keinen Hostnamen (Requirement 9.3). Die Ursache steht im
 * Protokolleintrag.
 */
function downMessage(reason: DatabaseProbeFailureReason, timeoutMs: number): string {
  return reason === 'timeout'
    ? `Datenbank hat nicht innerhalb von ${timeoutMs} ms geantwortet.`
    : 'Datenbank nicht erreichbar.';
}

/**
 * Terminus-Indikator für die Erreichbarkeit der Datenbank (Requirement 9.7,
 * 9.8, 9.9).
 *
 * Trägt absichtlich kein `@Injectable()`: Die Klasse wird in `health.module.ts`
 * über eine Factory erzeugt, damit der Type-Check dort bestätigt, dass
 * `PrismaService` die von `DatabasePingClient` verlangte Form erfüllt. Mit
 * `@Injectable()` und einem schnittstellengetippten Parameter könnte die Klasse
 * versehentlich direkt in `providers` landen, wo Nest die Abhängigkeit zur
 * Laufzeit nicht auflösen kann.
 *
 * Der Logger ist ein Konstruktorargument mit Vorgabewert, damit ein Test das
 * Ausgabeziel übernehmen kann, ohne dass die Anwendung ihn kennen muss.
 */
export class DatabaseHealthIndicator {
  constructor(
    private readonly healthIndicators: HealthIndicatorService,
    private readonly client: DatabasePingClient,
    private readonly logger: SentenzaLogger = createLogger({ component: 'health' }),
    private readonly timeoutMs: number = DATABASE_PROBE_TIMEOUT_MS,
  ) {}

  /**
   * Prüft die Datenbank und bildet das Ergebnis auf die von Terminus erwartete
   * Form ab: `up` mit Dauer, `down` mit Dauer und benannter Ursache. Ein
   * `down`-Ergebnis setzt den Gesamtzustand der Antwort auf `error`
   * (Requirement 9.9).
   */
  async check(): Promise<HealthIndicatorResult<typeof DATABASE_INDICATOR_KEY>> {
    const session = this.healthIndicators.check(DATABASE_INDICATOR_KEY);
    const result = await probeDatabase(this.client, this.timeoutMs);

    if (result.reachable) {
      return session.up({ durationMs: result.durationMs });
    }

    // Requirement 9.3, 9.4: die technische Ursache gehört ins Protokoll, nicht
    // in die Antwort.
    this.logger.warn('Datenbankprüfung des Health-Endpunkts fehlgeschlagen', {
      step: 'health.database',
      reason: result.reason,
      durationMs: result.durationMs,
      cause: result.cause,
    });

    return session.down({
      durationMs: result.durationMs,
      message: downMessage(result.reason, this.timeoutMs),
    });
  }
}
