import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { sentenzaVitestConfig } from '../base.js';

/**
 * Belegt, dass die geteilte Vitest-Basiskonfiguration die geforderten
 * Grundeinstellungen setzt, und dient zugleich als lauffähiges Beispiel für
 * einen `fast-check`-Test in diesem Monorepo.
 */
describe('sentenzaVitestConfig', () => {
  it('läuft ohne Beobachtungsmodus', () => {
    expect(sentenzaVitestConfig.test?.watch).toBe(false);
  });

  it('beschränkt Testdateien auf das Muster **/__tests__/*.test.ts', () => {
    expect(sentenzaVitestConfig.test?.include).toEqual(['**/__tests__/*.test.ts']);
  });

  it('verwendet den default-Reporter', () => {
    expect(sentenzaVitestConfig.test?.reporters).toEqual(['default']);
  });
});

describe('fast-check smoke test', () => {
  it('addiert zwei nicht-negative ganze Zahlen kommutativ', () => {
    fc.assert(
      fc.property(fc.nat(), fc.nat(), (a, b) => a + b === b + a),
      { numRuns: 100 },
    );
  });
});
