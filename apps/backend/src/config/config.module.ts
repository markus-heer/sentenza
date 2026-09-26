import { Global, Module } from '@nestjs/common';

import { loadConfig, type SentenzaConfig } from './configuration.js';

/**
 * Injektionsschlüssel der validierten Konfiguration.
 *
 * Eine Zeichenkette und kein `Symbol`, damit eine nicht auflösbare
 * Abhängigkeit im Fehlertext von Nest lesbar benannt ist.
 */
export const SENTENZA_CONFIG = 'SENTENZA_CONFIG';

/**
 * Stellt `SentenzaConfig` im Abhängigkeitsbaum bereit (design.md, Abschnitt
 * "Konfiguration und Bootstrap").
 *
 * `loadConfig` bleibt die einzige Stelle, die `process.env` liest; die Module
 * bekommen ausschließlich das geprüfte Ergebnis. Fehlt eine Variable, wirft
 * bereits `main.ts` vor dem Aufbau der Anwendung — dieser Provider läuft
 * danach und findet dieselbe Umgebung vor.
 *
 * Global registriert wie `PrismaModule`: Konfiguration braucht praktisch jedes
 * Feature-Modul, und ein Import in jedem einzelnen wäre Beiwerk ohne
 * Aussagekraft.
 *
 * Bewusst nicht `@nestjs/config`: Validierung, Vorgabewerte und die
 * verschachtelte Form liegen vollständig in `configuration.ts`; ein zweiter
 * Mechanismus mit eigener Vorstellung von Vorgabewerten daneben wäre eine
 * Quelle für Abweichungen.
 */
@Global()
@Module({
  providers: [
    {
      provide: SENTENZA_CONFIG,
      useFactory: (): SentenzaConfig => loadConfig(process.env),
    },
  ],
  exports: [SENTENZA_CONFIG],
})
export class ConfigModule {}
