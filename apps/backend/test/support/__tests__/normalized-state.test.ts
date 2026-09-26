import { describe, expect, it } from 'vitest';

import type {
  GrammarCategory,
  GrammarProgress,
  GrammarTopic,
  UserAccount,
} from '../../../src/prisma/prisma.types.js';
import {
  type NormalizedState,
  normalizedStateEquals,
  type NormalizedStateRows,
  toNormalizedState,
} from '../normalized-state.js';

/**
 * Vergleich zweier normalisierter Datenbestände (Aufgabe 12.1; Requirement 6.8).
 *
 * Ohne Testdatenbank, und das mit Absicht: `toNormalizedState` und
 * `normalizedStateEquals` sind reine Funktionen über Prisma-Zeilen. Ein
 * `createTestDatabaseClient()` würde hier nichts prüfen, was die Zeilenliterale
 * nicht auch prüfen — es würde lediglich den Fall „abweichende technische
 * Kennungen bei gleichem fachlichen Bestand" schwerer herstellbar machen, weil
 * `@default(uuid())` die Kennungen vergibt. Die Datenbank kommt mit den
 * Round-Trip-Eigenschaften 1 und 2 (Aufgabe 12.5, 12.6), die diese Funktion
 * dann als Prüfmittel verwenden.
 *
 * Kein Nest-Abhängigkeitsbaum, kein Netzzugriff.
 */

const ACCOUNT_ID = 'account-1';
const OBSERVED_AT = new Date('2026-09-25T08:00:00.000Z');

/** Ein Zeitstempel der Datensatzpflege; nach Requirement 6.8 ohne Belang. */
const HOUSEKEEPING = new Date('2026-01-01T00:00:00.000Z');

function account(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id: ACCOUNT_ID,
    googleSubject: 'google-subject-1',
    email: 'nutzer@example.com',
    createdAt: HOUSEKEEPING,
    updatedAt: HOUSEKEEPING,
    ...overrides,
  };
}

function category(overrides: Partial<GrammarCategory> = {}): GrammarCategory {
  return {
    id: 'category-1',
    language: 'ES',
    busuuId: 'grammar_category_es_1',
    nameKey: 'grammar_category_es_1_name',
    nameDe: 'Artikel',
    nameEn: 'Articles',
    nameDeResolved: true,
    nameEnResolved: true,
    descriptionKey: 'grammar_category_es_1_desc',
    descriptionDe: 'Bestimmte und unbestimmte Artikel',
    descriptionEn: 'Definite and indefinite articles',
    descDeResolved: true,
    descEnResolved: true,
    inCatalog: true,
    firstSeenAt: HOUSEKEEPING,
    lastSeenInCatalogAt: HOUSEKEEPING,
    createdAt: HOUSEKEEPING,
    updatedAt: HOUSEKEEPING,
    ...overrides,
  };
}

function topic(overrides: Partial<GrammarTopic> = {}): GrammarTopic {
  return {
    id: 'topic-1',
    language: 'ES',
    busuuId: 'grammar_topic_es_1_3',
    categoryId: 'category-1',
    sortPosition: 1,
    cefrLevel: 'B1',
    cefrLevelRaw: null,
    nameKey: 'grammar_topic_es_1_3_name',
    nameDe: 'Der bestimmte Artikel',
    nameEn: 'The definite article',
    nameDeResolved: true,
    nameEnResolved: true,
    descriptionKey: 'grammar_topic_es_1_3_desc',
    descriptionDe: 'el, la, los, las',
    descriptionEn: 'el, la, los, las',
    descDeResolved: true,
    descEnResolved: true,
    premium: false,
    accessTier: '',
    incomplete: false,
    inCatalog: true,
    firstSeenAt: HOUSEKEEPING,
    lastSeenInCatalogAt: HOUSEKEEPING,
    createdAt: HOUSEKEEPING,
    updatedAt: HOUSEKEEPING,
    ...overrides,
  };
}

function progress(overrides: Partial<GrammarProgress> = {}): GrammarProgress {
  return {
    id: 'progress-1',
    userAccountId: ACCOUNT_ID,
    grammarTopicId: 'topic-1',
    strength: 3,
    percentage: 60,
    observedAt: OBSERVED_AT,
    rawPayloadId: 'raw-payload-1',
    createdAt: HOUSEKEEPING,
    updatedAt: HOUSEKEEPING,
    ...overrides,
  };
}

/** Der vollständige Bestand eines Katalog- und eines Lernstands-Payloads. */
function rows(overrides: Partial<NormalizedStateRows> = {}): NormalizedStateRows {
  return {
    userAccounts: [account()],
    categories: [category()],
    topics: [topic()],
    progress: [progress()],
    ...overrides,
  };
}

function state(overrides: Partial<NormalizedStateRows> = {}): NormalizedState {
  return toNormalizedState(rows(overrides));
}

describe('toNormalizedState', () => {
  it('lässt technische Kennungen und Zeitstempel der Datensatzpflege weg', () => {
    const normalized = state();

    // Was im Zustandsmodell nicht existiert, kann der Vergleich nicht heranziehen.
    expect(Object.keys(normalized.categories[0] ?? {})).not.toContain('id');
    expect(Object.keys(normalized.topics[0] ?? {})).toEqual(
      expect.not.arrayContaining(['id', 'categoryId', 'createdAt', 'updatedAt', 'firstSeenAt']),
    );
    expect(Object.keys(normalized.progress[0] ?? {})).toEqual(
      expect.not.arrayContaining(['id', 'userAccountId', 'grammarTopicId', 'rawPayloadId']),
    );
  });

  it('löst Fremdschlüssel zu fachlichen Schlüsseln auf', () => {
    const normalized = state();

    expect(normalized.topics[0]?.category).toEqual({
      language: 'ES',
      busuuId: 'grammar_category_es_1',
    });
    expect(normalized.progress[0]?.googleSubject).toBe('google-subject-1');
    expect(normalized.progress[0]?.topic).toEqual({
      language: 'ES',
      busuuId: 'grammar_topic_es_1_3',
    });
  });

  it('behält den Beobachtungszeitpunkt eines Lernstands', () => {
    // Requirement 5.3: `observedAt` ist ein fachlicher Feldwert, kein
    // Zeitstempel der Datensatzpflege.
    expect(state().progress[0]?.observedAt).toEqual(OBSERVED_AT);
  });

  it('nimmt ein Thema ohne Kategorie an (Requirement 4.17, 5.4)', () => {
    const normalized = state({ topics: [topic({ categoryId: null })] });

    expect(normalized.topics[0]?.category).toBeNull();
  });

  it('wirft bei einem Fremdschlüssel ohne übergebene Entität', () => {
    // Ein vergessenes `findMany` darf nicht als stillschweigend fehlende
    // Zuordnung durchgehen — das würde den Vergleich nachsichtiger machen.
    expect(() => state({ topics: [] })).toThrowError(/grammarTopicId/);
  });
});

describe('normalizedStateEquals', () => {
  it('hält gleiche Bestände für gleich', () => {
    const comparison = normalizedStateEquals(state(), state());

    expect(comparison.report).toBe('');
    expect(comparison.equal).toBe(true);
    expect(comparison.differences).toEqual([]);
  });

  it('hält leere Bestände für gleich', () => {
    const empty = toNormalizedState({});

    expect(normalizedStateEquals(empty, empty).equal).toBe(true);
    expect(normalizedStateEquals(empty, empty).report).toBe('');
  });

  it('übergeht abweichende technische Kennungen und Zeitstempel (Requirement 6.8)', () => {
    // Derselbe fachliche Bestand, zweimal normalisiert: andere UUIDs, andere
    // Erzeugungs- und Änderungszeitstempel, anderes `firstSeenAt`,
    // `lastSeenInCatalogAt` und ein anderer Herkunfts-RawPayload. Genau das
    // trennt einen Round-Trip von einem Fehlschlag.
    const spaeter = new Date('2026-12-24T18:00:00.000Z');
    const zweiterLauf = state({
      userAccounts: [account({ id: 'account-2', createdAt: spaeter, updatedAt: spaeter })],
      categories: [
        category({
          id: 'category-99',
          firstSeenAt: spaeter,
          lastSeenInCatalogAt: null,
          createdAt: spaeter,
          updatedAt: spaeter,
        }),
      ],
      topics: [
        topic({
          id: 'topic-99',
          categoryId: 'category-99',
          firstSeenAt: spaeter,
          lastSeenInCatalogAt: null,
          createdAt: spaeter,
          updatedAt: spaeter,
        }),
      ],
      progress: [
        progress({
          id: 'progress-99',
          userAccountId: 'account-2',
          grammarTopicId: 'topic-99',
          rawPayloadId: 'raw-payload-2',
          createdAt: spaeter,
          updatedAt: spaeter,
        }),
      ],
    });

    const comparison = normalizedStateEquals(state(), zweiterLauf);

    expect(comparison.report).toBe('');
    expect(comparison.equal).toBe(true);
  });

  it('meldet einen abweichenden fachlichen Feldwert samt Stelle', () => {
    const comparison = normalizedStateEquals(
      state(),
      state({ topics: [topic({ cefrLevel: 'UNBEKANNT', cefrLevelRaw: 'zz' })] }),
    );

    expect(comparison.equal).toBe(false);
    expect(comparison.differences).toEqual([
      {
        kind: 'value',
        path: 'topics[["ES","grammar_topic_es_1_3"]].cefrLevel',
        inA: 'B1',
        inB: 'UNBEKANNT',
      },
      {
        kind: 'value',
        path: 'topics[["ES","grammar_topic_es_1_3"]].cefrLevelRaw',
        inA: null,
        inB: 'zz',
      },
    ]);
    // Der Bericht benennt die Stelle, damit ein Gegenbeispiel von fast-check
    // lesbar bleibt (Requirement 10.5).
    expect(comparison.report).toContain('topics[["ES","grammar_topic_es_1_3"]].cefrLevel');
    expect(comparison.report).toContain('a = "B1", b = "UNBEKANNT"');
  });

  it('meldet einen abweichenden Beobachtungszeitpunkt', () => {
    const comparison = normalizedStateEquals(
      state(),
      state({ progress: [progress({ observedAt: new Date('2026-09-26T08:00:00.000Z') })] }),
    );

    expect(comparison.equal).toBe(false);
    expect(comparison.differences[0]?.path).toBe(
      'progress[["google-subject-1","ES","grammar_topic_es_1_3"]].observedAt',
    );
  });

  it('meldet eine abweichende Anzahl in beide Richtungen', () => {
    const zweitesThema = topic({ id: 'topic-2', busuuId: 'grammar_topic_es_1_4', sortPosition: 2 });
    const grosser = state({ topics: [topic(), zweitesThema] });

    const fehltRechts = normalizedStateEquals(grosser, state());
    expect(fehltRechts.equal).toBe(false);
    expect(fehltRechts.differences).toEqual([
      expect.objectContaining({
        kind: 'missing-in-b',
        path: 'topics[["ES","grammar_topic_es_1_4"]]',
      }),
    ]);

    const fehltLinks = normalizedStateEquals(state(), grosser);
    expect(fehltLinks.differences).toEqual([
      expect.objectContaining({
        kind: 'missing-in-a',
        path: 'topics[["ES","grammar_topic_es_1_4"]]',
      }),
    ]);
  });

  it('ordnet Entitäten über den fachlichen Schlüssel, nicht über die Reihenfolge', () => {
    const zweiteKategorie = category({ id: 'category-2', busuuId: 'grammar_category_es_2' });
    const vorwaerts = state({ categories: [category(), zweiteKategorie] });
    const rueckwaerts = state({ categories: [zweiteKategorie, category()] });

    expect(normalizedStateEquals(vorwaerts, rueckwaerts).equal).toBe(true);
  });

  it('meldet einen doppelten fachlichen Schlüssel innerhalb eines Bestands', () => {
    // Aus der Datenbank unmöglich (`@@unique([language, busuuId])`), aus einem
    // von Hand gebauten Bestand nicht — und dort wäre ein verschluckter
    // Doppeleintrag eine Lücke im Vergleich.
    const doppelt = state({ categories: [category(), category({ id: 'category-2' })] });

    const comparison = normalizedStateEquals(doppelt, doppelt);

    expect(comparison.equal).toBe(false);
    expect(comparison.differences.map((difference) => difference.kind)).toEqual([
      'duplicate-key',
      'duplicate-key',
    ]);
  });
});
