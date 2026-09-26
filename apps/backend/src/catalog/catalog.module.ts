import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service.js';
import { CatalogResolver } from './catalog.resolver.js';
import { CatalogService } from './catalog.service.js';

/**
 * Catalog-Modul: die Abfrage von Katalog und Lernstand (Requirement 7;
 * design.md, Abschnitt "Catalog- und Progress-Abfragemodul").
 *
 * Beide Provider entstehen über Factories und nicht über
 * `providers: [Klasse]` — dieselbe Entscheidung wie im Auth-Modul und aus
 * demselben Grund: Ihre Abhängigkeiten sind Schnittstellen, die Nest zur
 * Laufzeit nicht auflösen könnte. Der Nebeneffekt ist der eigentliche Gewinn —
 * der Type-Check prüft an dieser Stelle, dass `PrismaService` die von
 * `CatalogStore` verlangte Form erfüllt und dass `CatalogService` das vom
 * Resolver verlangte Verfahren mitbringt. Ändert Prisma eine Signatur, schlägt
 * der Build hier fehl statt der Betrieb zur Laufzeit.
 *
 * `PrismaService` kommt aus dem global registrierten `PrismaModule` und muss
 * hier nicht importiert werden.
 *
 * `CatalogResolver` steht in `providers` und nicht in einem eigenen Modul, weil
 * `GraphQLModule` die Resolver über die Provider aller Module einsammelt; ein
 * Export ist dafür nicht nötig. `CatalogService` wird ausdrücklich nicht
 * exportiert: Die Abfrage hat außerhalb dieses Moduls keinen Aufrufer, und ein
 * Export würde einen nahelegen.
 *
 * Kein Zutun für den Zugriffsschutz: `GqlAuthGuard` ist in `auth.module.ts`
 * global registriert, und die Katalog-Query trägt kein `@Public()`
 * (Requirement 2.10).
 */
@Module({
  providers: [
    {
      provide: CatalogService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CatalogService(prisma),
    },
    {
      provide: CatalogResolver,
      inject: [CatalogService],
      useFactory: (catalogService: CatalogService) => new CatalogResolver(catalogService),
    },
  ],
})
export class CatalogModule {}
