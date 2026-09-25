import { HealthIndicatorService } from '@nestjs/terminus';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../common/logger.js';
import { DATABASE_INDICATOR_KEY, DatabaseHealthIndicator } from '../database.health.js';
import { DatabasePingClient } from '../probe-database.js';

/** Sammelt die Protokollzeilen, statt sie auf die Standardausgabe zu schreiben. */
function capturingLogger(): { lines: string[]; logger: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  const logger = createLogger({
    component: 'health',
    level: 'debug',
    sink: (line) => lines.push(line),
  });

  return { lines, logger };
}

function indicatorFor(
  client: DatabasePingClient,
  timeoutMs = 20,
): { indicator: DatabaseHealthIndicator; lines: string[] } {
  const { lines, logger } = capturingLogger();
  const indicator = new DatabaseHealthIndicator(
    new HealthIndicatorService(),
    client,
    logger,
    timeoutMs,
  );

  return { indicator, lines };
}

describe('DatabaseHealthIndicator', () => {
  it('meldet die Datenbank als `up` und nennt die Dauer', async () => {
    const { indicator } = indicatorFor({ $queryRaw: async () => [{ one: 1 }] });

    const result = await indicator.check();

    expect(result[DATABASE_INDICATOR_KEY].status).toBe('up');
    expect(result[DATABASE_INDICATOR_KEY].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('meldet die Datenbank als `down`, benennt sie und nennt keine technische Ursache', async () => {
    const { indicator } = indicatorFor({
      $queryRaw: async () => {
        throw new Error('Can not reach database server at db-host:5432');
      },
    });

    const result = await indicator.check();
    const database = result[DATABASE_INDICATOR_KEY];

    expect(Object.keys(result)).toEqual([DATABASE_INDICATOR_KEY]);
    expect(database.status).toBe('down');
    expect(database.durationMs).toBeGreaterThanOrEqual(0);
    expect(database.message).toBe('Datenbank nicht erreichbar.');
    // Requirement 9.3: keine Datenbankmeldung und kein Hostname nach außen.
    expect(JSON.stringify(result)).not.toContain('db-host');
  });

  it('nennt bei ausgeschöpftem Zeitlimit die Frist in der Meldung', async () => {
    const { indicator } = indicatorFor(
      { $queryRaw: () => new Promise<never>(() => undefined) },
      20,
    );

    const result = await indicator.check();

    expect(result[DATABASE_INDICATOR_KEY].status).toBe('down');
    expect(result[DATABASE_INDICATOR_KEY].message).toBe(
      'Datenbank hat nicht innerhalb von 20 ms geantwortet.',
    );
  });

  it('protokolliert die technische Ursache eines Fehlschlags', async () => {
    const { indicator, lines } = indicatorFor({
      $queryRaw: async () => {
        throw new Error('connection refused');
      },
    });

    await indicator.check();

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(entry.level).toBe('warn');
    expect(entry.component).toBe('health');
    expect(entry.step).toBe('health.database');
    expect(entry.cause).toBe('connection refused');
  });

  it('protokolliert nichts, solange die Datenbank antwortet', async () => {
    const { indicator, lines } = indicatorFor({ $queryRaw: async () => [{ one: 1 }] });

    await indicator.check();

    expect(lines).toEqual([]);
  });
});
