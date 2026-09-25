import { Module } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';

import { PrismaService } from '../prisma/prisma.service.js';
import { DatabaseHealthIndicator } from './database.health.js';
import { HealthController } from './health.controller.js';

/**
 * Health-Modul (Requirement 9.7–9.9, design.md Abschnitt "Health-Endpunkt").
 *
 * `PrismaService` kommt aus dem global registrierten `PrismaModule` und muss
 * hier nicht importiert werden.
 *
 * Der Indikator wird über eine Factory erzeugt statt über
 * `providers: [DatabaseHealthIndicator]`: So prüft der Type-Check an dieser
 * Stelle, dass `PrismaService` die von `DatabasePingClient` verlangte Form
 * erfüllt. Ändert Prisma die Signatur von `$queryRaw`, schlägt der Type-Check
 * hier fehl statt der Health-Endpunkt zur Laufzeit.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [
    {
      provide: DatabaseHealthIndicator,
      inject: [HealthIndicatorService, PrismaService],
      useFactory: (healthIndicators: HealthIndicatorService, prisma: PrismaService) =>
        new DatabaseHealthIndicator(healthIndicators, prisma),
    },
  ],
})
export class HealthModule {}
