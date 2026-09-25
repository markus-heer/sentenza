import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Global registriert, damit jedes Feature-Modul `PrismaService` injizieren
 * kann, ohne `PrismaModule` selbst zu importieren (übliches Muster für
 * Prisma in NestJS).
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
