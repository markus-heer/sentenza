import { CefrLevel, TargetLanguage } from '@sentenza/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { resetDatabase } from '../../../test/reset-database.js';
import { createTestDatabaseClient } from '../../../test/test-database-client.js';
import type { PrismaClient } from '../../prisma/prisma.types.js';
import {
  type CatalogCategoryRecord,
  CatalogService,
  type CatalogStore,
  type CatalogTopicRecord,
  CATEGORY_ORDER,
  TOPIC_ORDER,
} from '../catalog.service.js';

/**
 * Tests für `CatalogService` (Requirement 7.1, 7.2, 7.8, 7.10).
 *
 * Zwei Teile, und die Trennung hat einen Grund. Was der Service selbst
 * entscheidet — welche Auswahl und welche Ordnung er der Datenbank aufträgt, wie
 * er die gelieferten Zeilen auf die GraphQL-Typen abbildet und auf ihre
 * Kategorien verteilt —, prüft der erste Teil gegen eine Prisma-Attrappe: Sie
 * schreibt mit, womit sie aufgerufen wurde, und liefert eine vorgegebene Folge
 * zurück. Genau das macht die Reihenfolge der Lieferung zur Vorgabe des Tests
 * statt zu einer Frage an die Datenbank.
 *
 * Die Ordnung selbst ist aber keine Eigenschaft des Services, sondern der
 * `ORDER BY`-Klausel: „Themen ohne Sortierposition zuletzt" steht als
 * `nulls: 'last'` in `TOPIC_ORDER` und wird von PostgreSQL ausgeführt. Eine
 * Attrappe könnte das nur behaupten. Der zweite Teil läuft deshalb gegen die
 * Testdatenbank.
 *
 * Kein Nest-Container in beiden Teilen: Der Service wird von Hand instanziiert.
 */

const ACCOUNT_ID = 'konto-des-angemeldeten-benutzers';

/** Eine Kategorie-Zeile mit unauffälligen Werten; Abweichungen kommen per Override. */
function categoryRecord(overrides: Partial<CatalogCategoryRecord> = {}): CatalogCategoryRecord {
  return {
    id: 'kategorie-1',
    busuuId: 'cat_1',
    language: TargetLanguage.ES,
    nameDe: 'Bezeichnung de',
    nameEn: 'Bezeichnung en',
    descriptionDe: 'Beschreibung de',
    descriptionEn: 'Beschreibung en',
    inCatalog: true,
    ...overrides,
  };
}

/** Eine Themen-Zeile mit unauffälligen Werten. */
function topicRecord(overrides: Partial<CatalogTopicRecord> = {}): CatalogTopicRecord {
  return {
    busuuId: 'topic_1',
    categoryId: 'kategorie-1',
    sortPosition: 1,
    cefrLevel: CefrLevel.A1,
    nameDe: 'Thema de',
    nameEn: 'Thema en',
    descriptionDe: 'Themenbeschreibung de',
    descriptionEn: 'Themenbeschreibung en',
    premium: false,
    accessTier: 'free',
    incomplete: false,
    inCatalog: true,
    ...overrides,
  };
}

/** Was die Attrappe entgegengenommen hat. */
interface RecordedQueries {
  categoryWhere: unknown[];
  categoryOrderBy: unknown[];
  topicWhere: unknown[];
  topicOrderBy: unknown[];
}

/**
 * Prisma als Attrappe. Sie erfüllt `CatalogStore` und damit genau die zwei
 * Lesezugriffe, die der Service braucht.
 *
 * Die Themenabfrage wertet `where.categoryId.in` tatsächlich aus — sonst wäre
 * nicht prüfbar, dass der Service die Liste richtig aufbaut. Sie sortiert
 * dagegen ausdrücklich nicht: Die Reihenfolge der Rückgabe ist die der
 * vorgegebenen Zeilen, und damit prüft der erste Teil, dass der Service sie
 * beim Verteilen auf die Kategorien beibehält.
 */
function serviceWith(seed: {
  categories: CatalogCategoryRecord[];
  topics?: CatalogTopicRecord[];
}): { service: CatalogService; calls: RecordedQueries } {
  const calls: RecordedQueries = {
    categoryWhere: [],
    categoryOrderBy: [],
    topicWhere: [],
    topicOrderBy: [],
  };

  const store: CatalogStore = {
    grammarCategory: {
      findMany: (args) => {
        calls.categoryWhere.push(args.where);
        calls.categoryOrderBy.push(args.orderBy);

        return Promise.resolve(
          seed.categories.filter((category) => category.language === args.where.language),
        );
      },
    },
    grammarTopic: {
      findMany: (args) => {
        calls.topicWhere.push(args.where);
        calls.topicOrderBy.push(args.orderBy);

        const categoryIds = new Set(args.where.categoryId.in);

        return Promise.resolve(
          (seed.topics ?? []).filter(
            (topic) => topic.categoryId !== null && categoryIds.has(topic.categoryId),
          ),
        );
      },
    },
  };

  return { service: new CatalogService(store), calls };
}

describe('CatalogService.findGrammarCatalog mit Prisma-Attrappe', () => {
  it('trägt der Datenbank die Zielsprache und die festgelegte Ordnung auf', async () => {
    const { service, calls } = serviceWith({
      categories: [categoryRecord()],
      topics: [topicRecord()],
    });

    await service.findGrammarCatalog({ userAccountId: ACCOUNT_ID, language: TargetLanguage.ES });

    // Requirement 7.1: die Kategorien genau dieser Zielsprache, aufsteigend
    // nach Busuu-Kennung.
    expect(calls.categoryWhere).toEqual([{ language: TargetLanguage.ES }]);
    expect(calls.categoryOrderBy).toEqual([[{ busuuId: 'asc' }]]);

    // Requirement 7.1: Themen nach Sortierposition, bei Gleichheit nach
    // Busuu-Kennung, positionslose zuletzt — als `ORDER BY` der Datenbank.
    expect(calls.topicWhere).toEqual([{ categoryId: { in: ['kategorie-1'] } }]);
    expect(calls.topicOrderBy).toEqual([
      [{ sortPosition: { sort: 'asc', nulls: 'last' } }, { busuuId: 'asc' }],
    ]);
  });

  it('bündelt die Themen aller Kategorien in genau einer Abfrage', async () => {
    const { service, calls } = serviceWith({
      categories: [
        categoryRecord({ id: 'kategorie-1', busuuId: 'cat_1' }),
        categoryRecord({ id: 'kategorie-2', busuuId: 'cat_2' }),
        categoryRecord({ id: 'kategorie-3', busuuId: 'cat_3' }),
      ],
    });

    await service.findGrammarCatalog({ userAccountId: ACCOUNT_ID, language: TargetLanguage.ES });

    // Requirement 7.7: eine Abfrage je Auflösungsebene, unabhängig von der
    // Anzahl der Kategorien — hier drei Kategorien und dennoch eine
    // Themenabfrage mit allen drei Kennungen.
    expect(calls.categoryWhere).toHaveLength(1);
    expect(calls.topicWhere).toEqual([
      { categoryId: { in: ['kategorie-1', 'kategorie-2', 'kategorie-3'] } },
    ]);
  });

  it('gibt je Grammatik_Thema die von Requirement 7.2 verlangten Felder zurück', async () => {
    const { service } = serviceWith({
      categories: [categoryRecord({ inCatalog: false })],
      topics: [
        topicRecord({
          busuuId: 'topic_pretérito',
          sortPosition: 7,
          cefrLevel: CefrLevel.B2,
          nameDe: 'Vergangenheit',
          nameEn: 'Past tense',
          descriptionDe: 'Eine lange, ungekürzte Beschreibung auf Deutsch.',
          descriptionEn: 'A long, untruncated description in English.',
          premium: true,
          accessTier: 'premium',
          incomplete: true,
          inCatalog: false,
        }),
      ],
    });

    const [category] = await service.findGrammarCatalog({
      userAccountId: ACCOUNT_ID,
      language: TargetLanguage.ES,
    });

    // Requirement 7.1: Kennung, Zielsprache und beide Sprachpaare der
    // Kategorie; `removedFromCatalog` ist die Umkehrung von `inCatalog`.
    expect(category).toMatchObject({
      busuuId: 'cat_1',
      language: TargetLanguage.ES,
      nameDe: 'Bezeichnung de',
      nameEn: 'Bezeichnung en',
      descriptionDe: 'Beschreibung de',
      descriptionEn: 'Beschreibung en',
      removedFromCatalog: true,
    });

    // Requirement 7.2: Kennung, Bezeichnung de/en, Beschreibung de/en,
    // CEFR_Level und Sortierposition, jeweils unverändert.
    expect(category?.topics).toEqual([
      {
        busuuId: 'topic_pretérito',
        nameDe: 'Vergangenheit',
        nameEn: 'Past tense',
        descriptionDe: 'Eine lange, ungekürzte Beschreibung auf Deutsch.',
        descriptionEn: 'A long, untruncated description in English.',
        cefrLevel: CefrLevel.B2,
        sortPosition: 7,
        premium: true,
        accessTier: 'premium',
        incomplete: true,
        removedFromCatalog: true,
        // Aufgabe 13.4 löst den Lernstand des angemeldeten Kontos auf; bis
        // dahin ist jedes Thema ein Ungeübtes_Thema und bleibt im Ergebnis
        // (Requirement 7.4).
        untrained: true,
        progress: null,
      },
    ]);
  });

  it('verteilt die Themen auf ihre Kategorie und behält die Reihenfolge der Lieferung', async () => {
    const { service } = serviceWith({
      categories: [
        categoryRecord({ id: 'kategorie-1', busuuId: 'cat_1' }),
        categoryRecord({ id: 'kategorie-2', busuuId: 'cat_2' }),
      ],
      // Absichtlich verschränkt geliefert: Das Verteilen darf die Reihenfolge
      // innerhalb einer Kategorie nicht verändern.
      topics: [
        topicRecord({ categoryId: 'kategorie-1', busuuId: 'a', sortPosition: 1 }),
        topicRecord({ categoryId: 'kategorie-2', busuuId: 'b', sortPosition: 1 }),
        topicRecord({ categoryId: 'kategorie-1', busuuId: 'c', sortPosition: 2 }),
        topicRecord({ categoryId: 'kategorie-2', busuuId: 'd', sortPosition: 2 }),
      ],
    });

    const categories = await service.findGrammarCatalog({
      userAccountId: ACCOUNT_ID,
      language: TargetLanguage.ES,
    });

    expect(categories.map((category) => category.busuuId)).toEqual(['cat_1', 'cat_2']);
    expect(categories[0]?.topics.map((topic) => topic.busuuId)).toEqual(['a', 'c']);
    expect(categories[1]?.topics.map((topic) => topic.busuuId)).toEqual(['b', 'd']);
  });

  it('lässt eine Kategorie ohne Thema mit leerer Themenliste stehen', async () => {
    const { service } = serviceWith({
      categories: [
        categoryRecord({ id: 'kategorie-1', busuuId: 'cat_1' }),
        categoryRecord({ id: 'kategorie-leer', busuuId: 'cat_2' }),
      ],
      topics: [topicRecord({ categoryId: 'kategorie-1' })],
    });

    const categories = await service.findGrammarCatalog({
      userAccountId: ACCOUNT_ID,
      language: TargetLanguage.ES,
    });

    // Requirement 7.10: eine leere Liste, kein Fehler und kein Wegfallen der
    // Kategorie.
    expect(categories).toHaveLength(2);
    expect(categories[1]?.topics).toEqual([]);
  });

  it('fragt ohne Kategorie zur Zielsprache keine Themen ab und gibt eine leere Liste zurück', async () => {
    const { service, calls } = serviceWith({
      categories: [],
      topics: [topicRecord()],
    });

    const categories = await service.findGrammarCatalog({
      userAccountId: ACCOUNT_ID,
      language: TargetLanguage.ES,
    });

    // Requirement 7.10: leere Liste, kein Fehler.
    expect(categories).toEqual([]);
    // Und keine Themenabfrage mit leerer `in`-Liste, die ohnehin nichts
    // liefern könnte.
    expect(calls.topicWhere).toEqual([]);
  });
});

describe('CatalogService.findGrammarCatalog gegen die Testdatenbank', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestDatabaseClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  /**
   * Legt zwei Kategorien mit Themen an, deren Reihenfolge beim Einfügen
   * ausdrücklich nicht die erwartete Ausgabereihenfolge ist. Sonst könnte die
   * Prüfung eine Ordnung bestätigen, die nur die Einfügereihenfolge ist.
   */
  async function seedCatalog(): Promise<void> {
    await prisma.grammarCategory.create({
      data: {
        id: 'db-kategorie-b',
        language: TargetLanguage.ES,
        busuuId: 'cat_b',
        topics: {
          create: [
            // Gleiche Sortierposition: die Busuu-Kennung entscheidet.
            { language: TargetLanguage.ES, busuuId: 'b_zweite', sortPosition: 1 },
            { language: TargetLanguage.ES, busuuId: 'b_erste', sortPosition: 1 },
            // Ohne Sortierposition (Requirement 4.17): gehört ans Ende, obwohl
            // die Kennung vor allen anderen liegt.
            { language: TargetLanguage.ES, busuuId: 'a_ohne_position', sortPosition: null },
            { language: TargetLanguage.ES, busuuId: 'b_dritte', sortPosition: 2 },
          ],
        },
      },
    });

    await prisma.grammarCategory.create({
      data: {
        id: 'db-kategorie-a',
        language: TargetLanguage.ES,
        busuuId: 'cat_a',
        topics: {
          create: [{ language: TargetLanguage.ES, busuuId: 'a_einzig', sortPosition: 3 }],
        },
      },
    });

    // Ein Thema ohne Kategoriezuordnung (Requirement 4.17, 5.4). Es gehört zu
    // keiner Kategorie und darf in keinem Ergebnis erscheinen.
    await prisma.grammarTopic.create({
      data: { language: TargetLanguage.ES, busuuId: 'z_ohne_kategorie', categoryId: null },
    });
  }

  it('ordnet Kategorien nach Busuu-Kennung und Themen nach Sortierposition, positionslose zuletzt', async () => {
    await seedCatalog();

    const service = new CatalogService(prisma);
    const categories = await service.findGrammarCatalog({
      userAccountId: ACCOUNT_ID,
      language: TargetLanguage.ES,
    });

    // Requirement 7.1: Kategorien aufsteigend nach Busuu-Kennung, also `cat_a`
    // vor `cat_b` — entgegen der Einfügereihenfolge.
    expect(categories.map((category) => category.busuuId)).toEqual(['cat_a', 'cat_b']);

    // Requirement 7.1: innerhalb der Kategorie nach Sortierposition, bei
    // Gleichheit nach Busuu-Kennung, positionslose Themen zuletzt.
    expect(categories[1]?.topics.map((topic) => topic.busuuId)).toEqual([
      'b_erste',
      'b_zweite',
      'b_dritte',
      'a_ohne_position',
    ]);
    expect(categories[1]?.topics.map((topic) => topic.sortPosition)).toEqual([1, 1, 2, null]);

    // Das Thema ohne Kategoriezuordnung erscheint in keiner Kategorie.
    const allBusuuIds = categories.flatMap((category) =>
      category.topics.map((topic) => topic.busuuId),
    );
    expect(allBusuuIds).not.toContain('z_ohne_kategorie');
    expect(allBusuuIds).toHaveLength(5);
  });

  it('gibt ohne persistierte Kategorie eine leere Liste und keinen Fehler zurück', async () => {
    const service = new CatalogService(prisma);

    // Requirement 7.10: leerer Bestand ist kein Fehlerfall.
    await expect(
      service.findGrammarCatalog({ userAccountId: ACCOUNT_ID, language: TargetLanguage.ES }),
    ).resolves.toEqual([]);
  });

  it('meldet die Ordnungsangaben, mit denen die Abfrage läuft, unverändert an Prisma', () => {
    // Die beiden Konstanten sind die Zusage aus Requirement 7.1 in der Form,
    // die Prisma versteht. Sie stehen hier als eigene Prüfung, weil der
    // Datenbankteil sie nur mittelbar über das Ergebnis belegt: Änderte jemand
    // `nulls` auf `'first'`, wäre die Ursache sonst erst im geordneten Ergebnis
    // zu suchen.
    expect(CATEGORY_ORDER).toEqual([{ busuuId: 'asc' }]);
    expect(TOPIC_ORDER).toEqual([
      { sortPosition: { sort: 'asc', nulls: 'last' } },
      { busuuId: 'asc' },
    ]);
  });
});
