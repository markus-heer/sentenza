import { Field, ID, Int, ObjectType } from '@nestjs/graphql';
import { CefrLevel } from '@sentenza/domain';

import type { GrammarTopic as GrammarTopicRecord } from '../../prisma/prisma.types.js';
import { GrammarProgress } from './grammar-progress.model.js';

/**
 * Ein Grammatik_Thema, wie die Katalog-Query es zurückgibt
 * (Requirement 7.2, 7.4; design.md, Abschnitt "Catalog- und
 * Progress-Abfragemodul").
 *
 * Die Feldmenge ist die des Entwurfs und damit schmaler als das Prisma-Modell.
 * Was fehlt, fehlt mit Absicht: die technische Kennung (`id`), weil die
 * Busuu-Kennung der fachliche Schlüssel ist und eine zweite Kennung nach außen
 * nur Verwechslungen ermöglicht; die Auflösungsmerkmale der Übersetzungen
 * (`nameKey`, `nameDeResolved` und ihre Geschwister) und `cefrLevelRaw`, weil
 * sie Prüfmittel der Normalisierung und der Round-Trip-Prüfung sind
 * (Requirement 6) und keine Angabe für einen Client; die Zeitstempel
 * (`firstSeenAt`, `lastSeenInCatalogAt`, `createdAt`, `updatedAt`), weil
 * Requirement 7.2 sie nicht nennt. Auch die Zielsprache steht nicht hier,
 * sondern an der Grammatik_Kategorie: Innerhalb einer Abfrage ist sie für jedes
 * Thema dieselbe, nämlich die des Arguments.
 *
 * `removedFromCatalog` ist die Umkehrung von `GrammarTopic.inCatalog` aus dem
 * Prisma-Modell. Die Umkehrung ist Absicht: Der Normalfall ist ein Thema, das
 * im Katalog steht, und ein Feld heißt besser nach dem auffälligen Fall. Ein
 * so gekennzeichnetes Thema wird nicht gelöscht und behält alle Angaben
 * einschließlich seines Lernstands (Requirement 4.15, 4.18).
 *
 * `cefrLevel` trägt den von Prisma erzeugten Typ und nicht die Enumeration
 * `CefrLevel` aus `@sentenza/domain` — aus demselben Grund wie die
 * Aufzählungsfelder in `ingestion/raw-payload.repository.ts`: Ein Wert einer
 * Zeichenketten-Enumeration ist der entsprechenden Literalvereinigung
 * zuweisbar, umgekehrt nicht. So kann der Service eine Prisma-Zeile ohne
 * Umwandlung und ohne unerreichbaren Fehlerzweig abbilden. Am erzeugten Schema
 * ändert das nichts: Den GraphQL-Typ bestimmt `@Field(() => CefrLevel)`, also
 * die in `graphql/register-enums.ts` angemeldete Domänen-Enumeration.
 *
 * `sortPosition` ist nullable, weil ein Thema, das in keiner `structure`
 * referenziert ist, ohne Sortierposition persistiert wird (Requirement 4.17).
 * Die Sortierung stellt genau diese Themen ans Ende (siehe
 * `catalog.service.ts`).
 */
@ObjectType({ description: 'Ein Grammatik_Thema des Busuu-Katalogs samt Lernstand.' })
export class GrammarTopic {
  @Field(() => ID, { description: 'Die Busuu-Kennung des Grammatik_Thema, unverändert.' })
  busuuId!: string;

  @Field(() => String, { description: 'Die Bezeichnung in der Sprache `de`.' })
  nameDe!: string;

  @Field(() => String, { description: 'Die Bezeichnung in der Sprache `en`.' })
  nameEn!: string;

  @Field(() => String, { description: 'Die ungekürzte Beschreibung in der Sprache `de`.' })
  descriptionDe!: string;

  @Field(() => String, { description: 'Die ungekürzte Beschreibung in der Sprache `en`.' })
  descriptionEn!: string;

  @Field(() => CefrLevel, {
    description: 'Das Niveau des Grammatik_Thema; `UNBEKANNT`, wenn es nicht abbildbar war.',
  })
  cefrLevel!: GrammarTopicRecord['cefrLevel'];

  @Field(() => Int, {
    nullable: true,
    description:
      'Die Position innerhalb der Grammatik_Kategorie; `null`, wenn das Thema in keiner Struktur referenziert ist.',
  })
  sortPosition!: number | null;

  @Field(() => Boolean, {
    description: 'Ob Busuu das Grammatik_Thema als zahlungspflichtig führt.',
  })
  premium!: boolean;

  @Field(() => String, { description: 'Die von Busuu gemeldete Zugangsstufe, unverändert.' })
  accessTier!: string;

  @Field(() => Boolean, {
    description:
      'Ob das Grammatik_Thema nur aus einer Struktur bekannt ist und daher ohne Bezeichnung und Beschreibung vorliegt.',
  })
  incomplete!: boolean;

  @Field(() => Boolean, {
    description: 'Ob das Grammatik_Thema im letzten Katalog-Payload nicht mehr enthalten war.',
  })
  removedFromCatalog!: boolean;

  @Field(() => Boolean, {
    description:
      'Ungeübtes_Thema: Zum angemeldeten Benutzerkonto liegt kein Lernstand zu diesem Grammatik_Thema vor.',
  })
  untrained!: boolean;

  @Field(() => GrammarProgress, {
    nullable: true,
    description: 'Der Lernstand des angemeldeten Benutzerkontos; `null` bei einem Ungeübten_Thema.',
  })
  progress!: GrammarProgress | null;
}
