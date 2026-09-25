import { describe, expect, it } from 'vitest';

import { DatabasePingClient, probeDatabase } from '../probe-database.js';

/** Client, der `SELECT 1` wie eine erreichbare Datenbank beantwortet. */
function reachableClient(): DatabasePingClient {
  return { $queryRaw: async () => [{ one: 1 }] };
}

/** Client, dessen Abfrage scheitert, wie bei geschlossener Verbindung. */
function failingClient(message: string): DatabasePingClient {
  return {
    $queryRaw: async () => {
      throw new Error(message);
    },
  };
}

/** Client, der nie antwortet; erzwingt den Lauf in das Zeitlimit. */
function hangingClient(): DatabasePingClient {
  return { $queryRaw: () => new Promise<never>(() => undefined) };
}

describe('probeDatabase', () => {
  it('meldet die Datenbank als erreichbar und nennt die Dauer', async () => {
    const result = await probeDatabase(reachableClient());

    expect(result.reachable).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('meldet einen Abfragefehler als nicht erreichbar und behält die Ursache', async () => {
    const result = await probeDatabase(failingClient('connection refused'));

    expect(result).toMatchObject({
      reachable: false,
      reason: 'unreachable',
      cause: 'connection refused',
    });
  });

  it('bricht eine nicht antwortende Datenbank nach dem Zeitlimit ab', async () => {
    const result = await probeDatabase(hangingClient(), 20);

    expect(result).toMatchObject({ reachable: false, reason: 'timeout' });
    expect(result.durationMs).toBeGreaterThanOrEqual(20);
  });

  it('wartet nach einer Antwort nicht auf das Zeitlimit', async () => {
    const startedAt = performance.now();

    await probeDatabase(reachableClient(), 5_000);

    expect(performance.now() - startedAt).toBeLessThan(1_000);
  });
});
