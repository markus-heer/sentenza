import { defineConfig, type UserConfig } from 'vitest/config';

/**
 * Geteilte Vitest-Basiskonfiguration für Sentenza (@sentenza/vitest-config).
 *
 * Anwendungen und Pakete importieren diese Basis in ihrer eigenen
 * `vitest.config.ts` und reichen paketspezifische Ergänzungen über
 * `mergeConfig` durch, statt die Grundeinstellungen erneut lokal zu
 * deklarieren (Requirement 1.3, sinngemäß auf Vitest übertragen):
 *
 * ```ts
 * import { defineConfig, mergeConfig } from 'vitest/config';
 * import { sentenzaVitestConfig } from '@sentenza/vitest-config';
 *
 * export default mergeConfig(
 *   sentenzaVitestConfig,
 *   defineConfig({
 *     test: {
 *       // paketspezifische Ergänzungen, z. B. globalSetup
 *     },
 *   }),
 * );
 * ```
 *
 * Festgelegt sind:
 * - Ausführung als einmaliger `vitest run` ohne Beobachtungsmodus
 *   (Requirement 10.1). `watch: false` ist die explizite Absicherung dafür;
 *   der Aufruf über `vitest run` in den `test`-Skripten ist die zweite.
 * - Testdateien ausschließlich nach dem Muster `**\/__tests__/*.test.ts`
 *   (Requirement 10.2).
 * - Der `default`-Reporter gibt je Testdatei und Testname sowie bei einem
 *   Fehlschlag den Unterschied zwischen erwartetem und beobachtetem Wert aus
 *   (Requirement 10.11).
 */
export const sentenzaVitestConfig: UserConfig = defineConfig({
  test: {
    watch: false,
    include: ['**/__tests__/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
    passWithNoTests: true,
  },
});

export default sentenzaVitestConfig;
