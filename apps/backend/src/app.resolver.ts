import { Query, Resolver } from '@nestjs/graphql';

import { DomainEnumProbe } from './graphql/domain-enum-probe.model.js';

/**
 * Platzhalter-Resolver ausschließlich zur Schema-Erzeugung (Aufgabe 4.4).
 *
 * NestJS' code-first GraphQL-Modul benötigt mindestens ein `Query`-Feld, um
 * ein gültiges Schema zu erzeugen; ohne ein solches Feld bricht
 * `GraphQLModule.forRoot` beim Start mit "Query root type must be provided"
 * ab. Da in diesem Stand noch kein fachlicher Resolver existiert (Auth,
 * Ingestion und Catalog folgen in den Aufgaben 6, 8, 13), stellt dieser
 * Resolver ein triviales Feld bereit, das `autoSchemaFile`-Erzeugung und
 * Bootstrap ermöglicht.
 *
 * `domainEnumProbe` gibt `DomainEnumProbe` zurück, dessen Felder alle fünf
 * per `registerEnumType` angemeldeten Enumerationen aus `@sentenza/domain`
 * referenzieren. GraphQL nimmt einen registrierten Enum-Typ nur dann in das
 * erzeugte Schema auf, wenn er von mindestens einem Feld, Argument oder
 * Eingabetyp erreichbar ist — `registerEnumType` allein reicht dafür nicht
 * aus. Ohne dieses Feld würden die Enumerationen zwar angemeldet, aber nicht
 * in `schema.gql` erscheinen, bis die echten Resolver sie verwenden. Entfällt,
 * sobald ein echtes Feld (Auth, Ingestion, Catalog) eine dieser
 * Enumerationen verwendet.
 *
 * Dieser Platzhalter ist bewusst nicht Teil eines Requirements und kann
 * entfallen oder neben echten Resolvern bestehen bleiben, sobald diese
 * existieren.
 */
@Resolver()
export class AppResolver {
  @Query(() => String, { description: 'Platzhalter-Query, bis reale Resolver existieren.' })
  ping(): string {
    return 'pong';
  }

  @Query(() => DomainEnumProbe, {
    description:
      'Platzhalter-Query, hält die Domänen-Enumerationen im generierten Schema sichtbar.',
  })
  domainEnumProbe(): DomainEnumProbe {
    return DomainEnumProbe.sample();
  }
}
