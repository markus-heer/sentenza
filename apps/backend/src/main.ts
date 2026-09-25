import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';
import { ConfigValidationError, loadConfig } from './config/configuration.js';
import { waitForDatabase } from './config/wait-for-database.js';

/**
 * Bootstrap nach design.md, Abschnitt "Konfiguration und Bootstrap":
 * Konfiguration laden, Datenbankverbindung abwarten, erst dann einen Port
 * öffnen (Requirement 1.12). GraphQL/Apollo-Aufbau folgt in Aufgabe 4.4.
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env); // Requirement 1.12: fehlende Variable → Abbruch
  await waitForDatabase(config.databaseUrl, config.startup.databaseTimeoutMs); // Frist aus DB_STARTUP_TIMEOUT_MS
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
}

/**
 * Benennt die Ursache des Startabbruchs, ohne die strukturierte, redigierende
 * Protokollierung aus Aufgabe 4.7 vorwegzunehmen: ein einfaches
 * `console.error` reicht für diese Aufgabe.
 */
function logStartupFailure(error: unknown): void {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
    return;
  }

  if (error instanceof Error) {
    console.error(`Start abgebrochen: ${error.message}`);
    return;
  }

  console.error('Start abgebrochen aus unbekanntem Grund:', error);
}

bootstrap().catch((error: unknown) => {
  logStartupFailure(error); // benennt Variable bzw. Datenbankverbindung
  process.exit(1);
});
