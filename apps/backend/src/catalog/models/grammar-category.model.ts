import { Field, ID, ObjectType } from '@nestjs/graphql';
import { TargetLanguage } from '@sentenza/domain';

import type { GrammarCategory as GrammarCategoryRecord } from '../../prisma/prisma.types.js';
import { GrammarTopic } from './grammar-topic.model.js';

/**
 * Eine Grammatik_Kategorie mit ihren Grammatik_Themen (Requirement 7.1;
 * design.md, Abschnitt "Catalog- und Progress-Abfragemodul").
 *
 * Die Feldmenge ist die des Entwurfs; die Begründung der Auslassungen steht in
 * `grammar-topic.model.ts` und gilt hier gleichlautend. Anders als beim Thema
 * steht die Zielsprache hier ausdrücklich im Ergebnis: Sie ist das Argument der
 * Abfrage, und ein Client, der mehrere Abfragen zusammenführt, soll jede
 * Kategorie ohne Rückgriff auf die Anfrage zuordnen können.
 *
 * `topics` ist nicht-nullable und enthält alle dieser Kategorie zugeordneten
 * Themen in der festgelegten Ordnung (siehe `catalog.service.ts`). Eine
 * Kategorie ohne Thema ergibt eine leere Liste und keinen Fehler
 * (Requirement 7.10).
 *
 * Wie beim Thema trägt das Aufzählungsfeld den von Prisma erzeugten Typ,
 * während `@Field(() => TargetLanguage)` die angemeldete Domänen-Enumeration
 * ins Schema schreibt.
 */
@ObjectType({ description: 'Eine Grammatik_Kategorie des Busuu-Katalogs mit ihren Themen.' })
export class GrammarCategory {
  @Field(() => ID, { description: 'Die Busuu-Kennung der Grammatik_Kategorie, unverändert.' })
  busuuId!: string;

  @Field(() => TargetLanguage, { description: 'Die Zielsprache, zu der die Kategorie gehört.' })
  language!: GrammarCategoryRecord['language'];

  @Field(() => String, { description: 'Die Bezeichnung in der Sprache `de`.' })
  nameDe!: string;

  @Field(() => String, { description: 'Die Bezeichnung in der Sprache `en`.' })
  nameEn!: string;

  @Field(() => String, { description: 'Die Beschreibung in der Sprache `de`.' })
  descriptionDe!: string;

  @Field(() => String, { description: 'Die Beschreibung in der Sprache `en`.' })
  descriptionEn!: string;

  @Field(() => Boolean, {
    description: 'Ob die Grammatik_Kategorie im letzten Katalog-Payload nicht mehr enthalten war.',
  })
  removedFromCatalog!: boolean;

  @Field(() => [GrammarTopic], {
    description:
      'Die zugeordneten Grammatik_Themen, aufsteigend nach Sortierposition und bei Gleichheit nach Busuu-Kennung.',
  })
  topics!: GrammarTopic[];
}
