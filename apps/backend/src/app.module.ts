import './graphql/register-enums.js';

import { join } from 'node:path';

import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';

import { AppResolver } from './app.resolver.js';
import { formatError } from './common/format-error.js';
import { HealthModule } from './health/health.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Wurzelmodul.
 *
 * `PrismaModule` ist bereits eingebunden, weil der Health-Endpunkt und alle
 * Feature-Module `PrismaService` benötigen (Aufgabe 4.3).
 *
 * Aufgabe 4.4 fügt das GraphQL-Modul hinzu: code-first über Apollo, Schema
 * erzeugt als `apps/backend/schema.gql` (Requirement 1.9, 7.8). Der Import
 * von `./graphql/register-enums.js` läuft als Seiteneffekt vor der
 * `GraphQLModule.forRoot`-Auswertung und meldet die aus `@sentenza/domain`
 * importierten Enumerationen bei GraphQL an (Requirement 1.4).
 *
 * `AppResolver` ist ein bewusst minimaler Platzhalter: NestJS' code-first
 * GraphQL-Aufbau verlangt mindestens ein `Query`-Feld, um ein gültiges
 * Schema zu erzeugen ("Query root type must be provided"). Es existieren in
 * diesem Stand noch keine echten Resolver (Auth, Ingestion, Catalog folgen
 * in den Aufgaben 6, 8, 13); der Platzhalter entfällt oder bleibt bestehen,
 * sobald reale Query-Felder vorhanden sind.
 *
 * Aufgabe 4.5 ergänzt `formatError` (Requirement 9.1, 9.2, 9.3):
 * `SentenzaError` bleibt erhalten, jede andere Ursache wird zu
 * `INTERNAL_SERVER_ERROR` ohne Aufrufstapel, Datenbankmeldung, Dateipfad
 * oder Hostnamen. `includeStacktraceInErrorResponses: false` unterdrückt
 * Apollos eigenes `stacktrace`-Extension-Feld auch in der
 * Entwicklungsumgebung.
 *
 * Aufgabe 4.9 bindet `HealthModule` ein: `GET /health` prüft die Datenbank
 * über Terminus mit `SELECT 1` und einem Zeitlimit von 5 Sekunden
 * (Requirement 9.7, 9.8, 9.9).
 */
@Module({
  imports: [
    PrismaModule,
    HealthModule,
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'schema.gql'),
      sortSchema: true,
      includeStacktraceInErrorResponses: false,
      formatError,
    }),
  ],
  providers: [AppResolver],
})
export class AppModule {}
