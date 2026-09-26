import type { TargetLanguage } from '@sentenza/domain';

import type {
  GrammarCategory as GrammarCategoryRecord,
  GrammarTopic as GrammarTopicRecord,
  Prisma,
} from '../prisma/prisma.types.js';
import { GrammarCategory } from './models/grammar-category.model.js';
import { GrammarTopic } from './models/grammar-topic.model.js';

/**
 * Ordnung der Grammatik_Kategorien: aufsteigend nach Busuu-Kennung
 * (Requirement 7.1).
 */
export const CATEGORY_ORDER: Prisma.GrammarCategoryOrderByWithRelationInput[] = [
  { busuuId: 'asc' },
];

/**
 * Ordnung der Grammatik_Themen innerhalb einer Grammatik_Kategorie: aufsteigend
 * nach Sortierposition, bei gleicher Sortierposition aufsteigend nach
 * Busuu-Kennung, Themen ohne Sortierposition zuletzt (Requirement 7.1;
 * design.md: „`NULLS LAST` ist die naheliegende Ordnung").
 *
 * Die Ordnung entsteht in der Datenbank und nicht im Speicher. Das ist möglich,
 * weil Prisma für nullable Skalarfelder `{ sort, nulls }` kennt — geprüft gegen
 * den erzeugten Client dieses Projekts: `GrammarTopicOrderByWithRelationInput`
 * lässt für `sortPosition` (im Unterschied zu `busuuId`) `SortOrderInput` zu,
 * also genau die Form mit `nulls`. Eine Nachsortierung im Speicher wäre damit
 * doppelte Arbeit und eine zweite Wahrheit; zudem deckt der Index
 * `@@index([categoryId, sortPosition, busuuId])` aus `schema.prisma` genau
 * diese Reihenfolge ab.
 *
 * `nulls: 'last'` steht ausdrücklich da, obwohl PostgreSQL bei `ASC` von sich
 * aus `NULLS LAST` ordnet: Die Ordnung soll nicht von der Vorgabe eines
 * Dialekts abhängen, sondern von der Zusage aus Requirement 7.1 — und die
 * fordert bei einer künftigen Umstellung auf `desc` weiterhin die
 * positionslosen Themen am Ende, was die Vorgabe dann gerade nicht liefern
 * würde.
 *
 * Der Vergleich der Busuu-Kennungen ist der der Datenbank, denn `busuuId` ist
 * eine Zeichenkette: Die Sortierfolge der Spalten-Collation entscheidet, nicht
 * die Ordnung der UTF-16-Codeeinheiten wie bei einem Vergleich in JavaScript.
 * Für die tatsächlichen Kennungen — Kleinbuchstaben, Ziffern und Unterstrich —
 * stimmen beide überein.
 */
export const TOPIC_ORDER: Prisma.GrammarTopicOrderByWithRelationInput[] = [
  { sortPosition: { sort: 'asc', nulls: 'last' } },
  { busuuId: 'asc' },
];

/**
 * Die Felder einer Grammatik_Kategorie, die die Abfrage liest.
 *
 * Bewusst als `Pick` über die Prisma-Zeile und nicht als eigene Deklaration:
 * Fällt ein Feld in `schema.prisma` weg oder ändert es seinen Typ, schlägt der
 * Type-Check hier fehl. `id` steht darin, obwohl es nicht im GraphQL-Typ
 * erscheint — die Themen werden darüber zugeordnet.
 */
export type CatalogCategoryRecord = Pick<
  GrammarCategoryRecord,
  | 'id'
  | 'busuuId'
  | 'language'
  | 'nameDe'
  | 'nameEn'
  | 'descriptionDe'
  | 'descriptionEn'
  | 'inCatalog'
>;

/** Die Felder eines Grammatik_Thema, die die Abfrage liest. */
export type CatalogTopicRecord = Pick<
  GrammarTopicRecord,
  | 'busuuId'
  | 'categoryId'
  | 'sortPosition'
  | 'cefrLevel'
  | 'nameDe'
  | 'nameEn'
  | 'descriptionDe'
  | 'descriptionEn'
  | 'premium'
  | 'accessTier'
  | 'incomplete'
  | 'inCatalog'
>;

/**
 * Die einzige Fähigkeit, die die Abfrage vom Prisma-Client je Modell braucht.
 *
 * So schmal geschnitten wie `AuthStore` in `auth/auth.service.ts` und
 * `RawPayloadStore` in `ingestion/raw-payload.repository.ts`: Die Auswahl, die
 * Bündelung und die Abbildung sind damit ohne laufende Nest-Anwendung und ohne
 * Datenbank prüfbar. `PrismaService` erfüllt diese Form; dass er es tut,
 * bestätigt der Type-Check an der Erzeugungsstelle in `catalog.module.ts`.
 *
 * Nur `findMany`, kein `create` und kein `update`: Dieses Modul liest
 * ausschließlich.
 */
export interface CatalogCategoryStore {
  findMany(args: {
    where: { language: GrammarCategoryRecord['language'] };
    orderBy: Prisma.GrammarCategoryOrderByWithRelationInput[];
  }): Promise<CatalogCategoryRecord[]>;
}

export interface CatalogTopicStore {
  findMany(args: {
    where: { categoryId: { in: string[] } };
    orderBy: Prisma.GrammarTopicOrderByWithRelationInput[];
  }): Promise<CatalogTopicRecord[]>;
}

export interface CatalogStore {
  grammarCategory: CatalogCategoryStore;
  grammarTopic: CatalogTopicStore;
}

/**
 * Die Filterargumente der Katalogabfrage (Requirement 7.5, 7.6, 7.11).
 *
 * In diesem Stand ohne Feld, und ausdrücklich als eigener Typ und nicht als
 * weggelassener Parameter: Aufgabe 13.2 setzt die Filter um — Liste von
 * CEFR_Level-Werten, Lernstands-Filter und `includeRemovedFromCatalog` — und
 * füllt diesen Typ samt der zugehörigen GraphQL-Eingabe. Dass der Parameter
 * schon in der Signatur steht, hält die Erweiterung auf diese eine Stelle
 * begrenzt.
 */
export type GrammarCatalogFilter = Record<string, never>;

/** Argumente einer Katalogabfrage. */
export interface GrammarCatalogQuery {
  /**
   * Das angemeldete Benutzerkonto. Kommt ausschließlich aus `@CurrentUser()`
   * und nie aus einem Eingabefeld (Requirement 2.12) — der Katalog selbst ist
   * nicht kontogebunden, der Lernstand daran schon (Requirement 7.3).
   *
   * In diesem Stand noch nicht ausgewertet: Die Auflösung des Lernstands folgt
   * in Aufgabe 13.4. Die Kennung steht hier bereits, damit sie nicht später
   * durch die Signatur nachgezogen werden muss und damit sichtbar ist, dass die
   * Abfrage ein Konto kennt.
   */
  userAccountId: string;
  /** Die abgefragte Zielsprache (Requirement 7.1). */
  language: TargetLanguage;
  /** Die Filter der Abfrage; ohne Angabe keine Einschränkung. */
  filter?: GrammarCatalogFilter;
}

/**
 * Bildet eine Prisma-Zeile auf den GraphQL-Typ des Grammatik_Thema ab
 * (Requirement 7.2).
 *
 * `removedFromCatalog` ist die Umkehrung von `inCatalog`; alle übrigen Felder
 * gehen unverändert durch, insbesondere die ungekürzten Beschreibungen
 * (Requirement 4.10) und `sortPosition` einschließlich `null`.
 */
function toGrammarTopic(record: CatalogTopicRecord): GrammarTopic {
  const topic = new GrammarTopic();

  topic.busuuId = record.busuuId;
  topic.nameDe = record.nameDe;
  topic.nameEn = record.nameEn;
  topic.descriptionDe = record.descriptionDe;
  topic.descriptionEn = record.descriptionEn;
  topic.cefrLevel = record.cefrLevel;
  topic.sortPosition = record.sortPosition;
  topic.premium = record.premium;
  topic.accessTier = record.accessTier;
  topic.incomplete = record.incomplete;
  topic.removedFromCatalog = !record.inCatalog;

  // Vorläufig und ausdrücklich so gekennzeichnet: Aufgabe 13.4 löst den
  // Lernstand des angemeldeten Kontos auf und setzt beide Felder danach
  // (Requirement 7.3, 7.4). Bis dahin ist jedes Thema ein Ungeübtes_Thema —
  // das ist genau der Zustand, den ein noch nicht befragter Lernstand ergibt,
  // und nicht etwa eine Behauptung über den Bestand. Requirement 7.4 gilt
  // schon jetzt: Das Thema bleibt im Ergebnis.
  topic.untrained = true;
  topic.progress = null;

  return topic;
}

/** Bildet eine Prisma-Zeile samt bereits geordneter Themen ab (Requirement 7.1). */
function toGrammarCategory(record: CatalogCategoryRecord, topics: GrammarTopic[]): GrammarCategory {
  const category = new GrammarCategory();

  category.busuuId = record.busuuId;
  category.language = record.language;
  category.nameDe = record.nameDe;
  category.nameEn = record.nameEn;
  category.descriptionDe = record.descriptionDe;
  category.descriptionEn = record.descriptionEn;
  category.removedFromCatalog = !record.inCatalog;
  category.topics = topics;

  return category;
}

/**
 * Die Katalogabfrage (Requirement 7.1, 7.2, 7.8; design.md, Abschnitt
 * "Catalog- und Progress-Abfragemodul").
 *
 * Zwei Abfragen, nicht eine je Kategorie: erst die Kategorien der Zielsprache,
 * dann in einem Zug alle Themen dieser Kategorien über eine `in`-Liste. Die
 * Anzahl der Datenbankabfragen ist damit von der Anzahl der Kategorien
 * unabhängig (Requirement 7.7). Ein verschachteltes `include` wäre die dritte
 * Möglichkeit und ist ausdrücklich nicht gewählt: Der Entwurf verlangt je
 * Auflösungsebene genau eine Abfrage, und diese Form ist dieselbe, die
 * Aufgabe 13.3 hinter einen DataLoader legt — dann gebündelt über die
 * Geschwister einer Ebene statt über die Kategorien eines Aufrufs.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `AuthService` wird die Klasse
 * über eine Factory im Modul erzeugt, weil ihr Mitspieler eine Schnittstelle
 * ist, die Nest zur Laufzeit nicht auflösen könnte.
 */
export class CatalogService {
  constructor(private readonly store: CatalogStore) {}

  /**
   * Alle Grammatik_Kategorien einer Zielsprache mit ihren Grammatik_Themen, in
   * der festgelegten Ordnung (Requirement 7.1, 7.2).
   *
   * Ohne Kategorie zur Zielsprache eine leere Liste und kein Fehler
   * (Requirement 7.10); die Themenabfrage entfällt dann, statt mit einer leeren
   * `in`-Liste zu laufen.
   *
   * Als entfernt gekennzeichnete Kategorien und Themen sind in diesem Stand
   * enthalten und über `removedFromCatalog` erkennbar. Die Vorgabe, sie ohne
   * ausdrückliche Anforderung auszulassen (Requirement 7.11), gehört zu den
   * Filtern und kommt mit Aufgabe 13.2.
   */
  async findGrammarCatalog(query: GrammarCatalogQuery): Promise<GrammarCategory[]> {
    const categories = await this.store.grammarCategory.findMany({
      where: { language: query.language },
      orderBy: CATEGORY_ORDER,
    });

    if (categories.length === 0) {
      return [];
    }

    const topicsByCategoryId = await this.findTopicsByCategoryId(
      categories.map((category) => category.id),
    );

    return categories.map((category) =>
      toGrammarCategory(category, topicsByCategoryId.get(category.id) ?? []),
    );
  }

  /**
   * Die Themen aller übergebenen Kategorien, auf ihre Kategorie verteilt.
   *
   * Die Datenbank liefert eine einzige, durchgehend geordnete Liste. Das
   * Verteilen in Eimer hält diese Reihenfolge ein, weil es die Zeilen in
   * Empfangsreihenfolge anhängt; eine Sortierung je Kategorie ist deshalb
   * nicht nötig. Die Ordnung innerhalb einer Kategorie ist genau die aus
   * `TOPIC_ORDER`.
   */
  private async findTopicsByCategoryId(
    categoryIds: string[],
  ): Promise<Map<string, GrammarTopic[]>> {
    const records = await this.store.grammarTopic.findMany({
      where: { categoryId: { in: categoryIds } },
      orderBy: TOPIC_ORDER,
    });

    const topicsByCategoryId = new Map<string, GrammarTopic[]>();

    for (const record of records) {
      const categoryId = record.categoryId;

      // Ein Thema ohne Kategoriezuordnung erscheint in keinem Ergebnis: Es ist
      // in keiner `structure` referenziert (Requirement 4.17) oder erst über
      // einen Lernstand entstanden (Requirement 5.4), und Requirement 7.1
      // gibt Kategorien mit ihren *zugeordneten* Themen zurück. Die `in`-Liste
      // schließt `null` schon aus; der Zweig steht allein dafür da, dass
      // `categoryId` im Prisma-Modell nullable ist.
      if (categoryId === null) {
        continue;
      }

      const topics = topicsByCategoryId.get(categoryId);

      if (topics === undefined) {
        topicsByCategoryId.set(categoryId, [toGrammarTopic(record)]);
      } else {
        topics.push(toGrammarTopic(record));
      }
    }

    return topicsByCategoryId;
  }
}
