import { Module } from '@nestjs/common';

import { PrismaModule } from './prisma/prisma.module.js';

/**
 * Minimales Wurzelmodul für die Startprüfungen aus `main.ts` (Aufgabe 4.3).
 * `PrismaModule` ist bereits eingebunden, weil der Health-Endpunkt und alle
 * Feature-Module `PrismaService` benötigen. GraphQL/Apollo, der Fehler-
 * formatierer, die Protokollierung und der Health-Endpunkt kommen in
 * Aufgabe 4.4 ff. hinzu — dieses Modul wird dort erweitert, nicht neu erstellt.
 */
@Module({
  imports: [PrismaModule],
})
export class AppModule {}
