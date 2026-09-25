import 'reflect-metadata';

import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { describe, expect, it, type Mock, vi } from 'vitest';

import { createLogger } from '../../common/logger.js';
import { DATABASE_INDICATOR_KEY, DatabaseHealthIndicator } from '../database.health.js';
import { HealthController } from '../health.controller.js';
import { DatabasePingClient } from '../probe-database.js';

/**
 * Kantenfalltest für Requirement 9.9: Ist die Datenbank nicht erreichbar, meldet
 * die Prüfung die Abhängigkeit `database` als nicht erreichbar. Geprüft wird
 * zusätzlich Requirement 9.3: Das Ergebnis trägt weder Datenbankmeldung noch
 * Dateipfad noch Hostnamen nach außen.
 *
 * Kein Nest-Container im Spiel: Vitest übersetzt TypeScript mit esbuild, und
 * esbuild erzeugt kein `emitDecoratorMetadata` — die Option steht allein in der
 * `tsconfig.json` und gilt damit für den Build. Nest könnte die
 * Konstruktorabhängigkeiten hier also nicht auflösen. Nach dem Vorbild von
 * `aos-metaforge` gilt deshalb die Konvention, die beteiligten Klassen im Test
 * von Hand zu instanziieren und die Datenschicht durch ein Double zu ersetzen.
 *
 * Geprüft wird entsprechend, was wir selbst besitzen: das Ergebnis des eigenen
 * Indikators und die Delegation des Controllers an den eingespritzten
 * `HealthCheckService`. Dass ein `down`-Ergebnis zum Gesamtzustand `error` und
 * damit zu HTTP 503 wird, ist dokumentiertes Verhalten von Terminus und ohne
 * Container nicht erreichbar; diese Abbildung fällt dem Integrationstest des
 * Hochfahrens zu (Aufgabe 17.4).
 */

/** Nachricht eines Prisma-Verbindungsfehlers mit Hostname, Port und Dateipfad. */
const PRISMA_FAILURE =
  "Can't reach database server at `db-host.internal`:5432\n" +
  '    at /Users/markus/Projects/Private/sentenza/node_modules/@prisma/client/runtime/library.js:112:19';

/**
 * Ergebnis, das der Doppelgänger des Health-Dienstes zurückgibt. Der Inhalt ist
 * beliebig: Geprüft wird nur, dass der Controller genau dieses Ergebnis
 * durchreicht, nicht wie Terminus es zusammensetzt.
 */
const AGGREGATED: HealthCheckResult = {
  status: 'ok',
  details: { [DATABASE_INDICATOR_KEY]: { status: 'up' } },
};

/**
 * Baut den Indikator über dem übergebenen Client. Der Logger schreibt ins
 * Nichts, damit die protokollierte technische Ursache nicht auf der
 * Standardausgabe landet; das kurze Zeitlimit hält den Test schnell.
 */
function indicatorFor(client: DatabasePingClient): DatabaseHealthIndicator {
  return new DatabaseHealthIndicator(
    new HealthIndicatorService(),
    client,
    createLogger({ component: 'health', sink: () => undefined }),
    20,
  );
}

/** Client, dessen Abfrage scheitert, wie bei nicht erreichbarer Datenbank. */
function unreachableClient(): DatabasePingClient {
  return {
    $queryRaw: async () => {
      throw new Error(PRISMA_FAILURE);
    },
  };
}

/** Client, der `SELECT 1` wie eine erreichbare Datenbank beantwortet. */
function reachableClient(): DatabasePingClient {
  return { $queryRaw: async () => [{ one: 1 }] };
}

type CheckDouble = Mock<
  (healthIndicators: HealthIndicatorFunction[]) => Promise<HealthCheckResult>
>;

/**
 * Doppelgänger des Health-Dienstes. `HealthCheckService` lässt sich nicht von
 * Hand erzeugen, weil Terminus die dafür nötige `HealthCheckExecutor`-Klasse
 * nicht exportiert; der Controller benutzt vom Dienst ohnehin nur `check`.
 */
function healthCheckDouble(): { service: HealthCheckService; check: CheckDouble } {
  const check: CheckDouble = vi.fn(() => Promise.resolve(AGGREGATED));

  return { service: { check } as unknown as HealthCheckService, check };
}

/**
 * Liest die Indikatorfunktionen des einzigen Aufrufs. Schlägt hier fehl, statt
 * die Abwesenheit des Aufrufs später als nichtssagende Abweichung zu zeigen.
 */
function handedIndicators(
  indicators: HealthIndicatorFunction[] | undefined,
): HealthIndicatorFunction[] {
  if (indicators === undefined) {
    expect.fail('Der Health-Dienst wurde nicht aufgerufen.');
  }

  return indicators;
}

describe('Datenbankprüfung des Health-Endpunkts', () => {
  it('meldet `database` bei nicht erreichbarer Datenbank als `down`', async () => {
    const result = await indicatorFor(unreachableClient()).check();

    // Requirement 9.9: die nicht erreichbare Abhängigkeit muss benannt sein.
    expect(Object.keys(result)).toEqual([DATABASE_INDICATOR_KEY]);
    expect(result[DATABASE_INDICATOR_KEY]).toMatchObject({
      status: 'down',
      message: 'Datenbank nicht erreichbar.',
    });
    expect(result[DATABASE_INDICATOR_KEY].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('nennt weder Datenbankmeldung noch Dateipfad noch Hostnamen', async () => {
    const serialized = JSON.stringify(await indicatorFor(unreachableClient()).check());

    // Requirement 9.3: nichts aus der technischen Ursache darf nach außen.
    expect(serialized).not.toContain('db-host.internal');
    expect(serialized).not.toContain('5432');
    expect(serialized).not.toContain('node_modules');
    expect(serialized).not.toContain("Can't reach");
  });

  it('meldet `database` als `up`, solange die Datenbank antwortet', async () => {
    // Gegenprobe: `down` entsteht aus dem Fehlschlag und nicht aus der Verdrahtung.
    const result = await indicatorFor(reachableClient()).check();

    expect(result[DATABASE_INDICATOR_KEY].status).toBe('up');
  });
});

describe('HealthController', () => {
  it('übergibt dem Health-Dienst genau eine Indikatorfunktion', async () => {
    const { service, check } = healthCheckDouble();
    const controller = new HealthController(service, indicatorFor(reachableClient()));

    await controller.check();

    expect(check).toHaveBeenCalledTimes(1);
    expect(handedIndicators(check.mock.calls[0]?.[0])).toHaveLength(1);
  });

  it('übergibt die Prüfung der Datenbank', async () => {
    const { service, check } = healthCheckDouble();
    const controller = new HealthController(service, indicatorFor(unreachableClient()));

    await controller.check();
    const [handed] = handedIndicators(check.mock.calls[0]?.[0]);

    if (typeof handed !== 'function') {
      expect.fail('Erwartet war eine aufrufbare Indikatorfunktion.');
    }

    // Die übergebene Funktion führt auf unseren Indikator, nicht auf einen
    // anderen: Sie liefert das Ergebnis der Datenbankprüfung.
    expect(await handed()).toMatchObject({
      [DATABASE_INDICATOR_KEY]: { status: 'down' },
    });
  });

  it('gibt das Ergebnis des Health-Dienstes unverändert zurück', async () => {
    const { service } = healthCheckDouble();
    const controller = new HealthController(service, indicatorFor(reachableClient()));

    expect(await controller.check()).toBe(AGGREGATED);
  });
});
