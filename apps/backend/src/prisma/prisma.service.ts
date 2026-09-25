import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { PrismaClient } from './prisma.types.js';

/**
 * Nest-Injectable rund um den generierten Prisma-Client. Baut die
 * Datenbankverbindung beim Start des Moduls auf und schließt sie beim
 * Herunterfahren wieder (Standardmuster für NestJS + Prisma).
 *
 * Erbt von der über `prisma.types.ts` re-exportierten `PrismaClient`, nicht
 * vom generierten Paket direkt (Requirement 1.10).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
