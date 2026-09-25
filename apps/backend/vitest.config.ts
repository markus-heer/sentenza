import { sentenzaVitestConfig } from '@sentenza/vitest-config';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Backend-spezifische Ergänzung der geteilten Vitest-Basis (design.md,
 * Abschnitt "Testdatenbank"): `global-setup.ts` prüft die Testdatenbank und
 * migriert sie, bevor der erste Test läuft. `pool: 'forks'` mit
 * `singleFork: true` bündelt alle Tests dieses Pakets in einem einzigen
 * Kindprozess, damit sich parallele Testdateien nicht dieselbe
 * Testdatenbank wegziehen (Requirement 10.7).
 */
export default mergeConfig(
  sentenzaVitestConfig,
  defineConfig({
    test: {
      globalSetup: ['./test/global-setup.ts'],
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
    },
  }),
);
