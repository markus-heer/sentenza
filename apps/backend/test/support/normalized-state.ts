import type {
  GrammarCategory,
  GrammarProgress,
  GrammarTopic,
  TargetLanguage,
  UserAccount,
} from '../../src/prisma/prisma.types.js';

/**
 * Vergleich zweier normalisierter Datenbestände nach Requirement 6.8
 * (design.md, Abschnitt "Generatoren für die Round-Trip-Eigenschaften").
 *
 * Requirement 6.8 legt fest, wann zwei Bestände als identisch gelten: wenn sie
 * in der Menge der fachlichen Schlüssel und in allen fachlichen Feldwerten
 * übereinstimmen. Technische Datenbank-Kennungen sowie Erzeugungs- und
 * Änderungszeitstempel bleiben unberücksichtigt. Genau daran hängt die
 * Aussagekraft der Round-Trip-Eigenschaften 1 und 2 (Aufgabe 12.5, 12.6): Ein
 * zu nachsichtiger Vergleich ließe sie grün werden, obwohl Felder verloren
 * gehen (siehe Risk Assessment, Zeile "Verlustfreiheit hängt an der
 * Vergleichsfunktion").
 *
 * Zwei Entwurfsentscheidungen dieser Datei folgen daraus:
 *
 * 1. **Die auszuklammernden Felder verschwinden im Typ, nicht im Vergleich.**
 *    `NormalizedCategory`, `NormalizedTopic` und `NormalizedProgress` entstehen
 *    als `Omit<…>` über den Prisma-Modelltypen. `id`, `categoryId`,
 *    `userAccountId`, `grammarTopicId`, `rawPayloadId`, `createdAt`,
 *    `updatedAt`, `firstSeenAt` und `lastSeenInCatalogAt` existieren im
 *    Zustandsmodell erst gar nicht; der Vergleich kann sie also nicht
 *    versehentlich heranziehen. Umgekehrt wird jedes Feld, das `schema.prisma`
 *    künftig hinzufügt, automatisch mitverglichen — die Richtung, in der ein
 *    Versehen laut wird statt still zu bleiben.
 * 2. **Der Vergleich läuft strukturell über die Vereinigung der Feldnamen**,
 *    nicht über eine im Code aufgeschriebene Feldliste. Eine Liste wäre die
 *    zweite Stelle, an der ein neues Feld nachzutragen wäre, und genau die
 *    Stelle, an der es vergessen würde.
 *
 * Die Datei greift bewusst **nicht** selbst auf die Datenbank zu. Aufrufer
 * lesen die Zeilen über `findMany` und übergeben sie an `toNormalizedState`.
 * Damit sind Projektion und Vergleich reine Funktionen und ohne Testdatenbank
 * prüfbar; die Datenbank brauchen erst die Round-Trip-Eigenschaften selbst.
 *
 * Liegt unter `test/support/` und damit außerhalb von `src/`: `tsconfig.json`
 * des Backends schließt `test` aus, eine ESLint-Regel verbietet Importe aus
 * `test/support/**` in `src/**` (Requirement 6.9, sinngemäß auch für dieses
 * Prüfmittel).
 */

/**
 * Fachlicher Schlüssel einer Grammatik_Kategorie und eines Grammatik_Thema:
 * das Paar aus Zielsprache und Busuu-Kennung, in `schema.prisma` als
 * `@@unique([language, busuuId])` hinterlegt.
 */
export interface EntityKey {
  readonly language: TargetLanguage;
  readonly busuuId: string;
}

/** Eine Grammatik_Kategorie ohne technische Kennung und ohne Zeitstempel. */
export type NormalizedCategory = Omit<
  GrammarCategory,
  'id' | 'firstSeenAt' | 'lastSeenInCatalogAt' | 'createdAt' | 'updatedAt'
>;

/**
 * Ein Grammatik_Thema ohne technische Kennung und ohne Zeitstempel. Die
 * Kategoriezuordnung steht als fachlicher Schlüssel statt als `categoryId`;
 * `null` bei einem Thema ohne Kategorie (Requirement 4.17, 5.4).
 */
export type NormalizedTopic = Omit<
  GrammarTopic,
  'id' | 'categoryId' | 'firstSeenAt' | 'lastSeenInCatalogAt' | 'createdAt' | 'updatedAt'
> & {
  readonly category: EntityKey | null;
};

/**
 * Ein Lernstand ohne technische Kennungen und ohne Zeitstempel der
 * Datensatzpflege. Sein fachlicher Schlüssel ist das Paar aus Benutzerkonto
 * und Grammatik_Thema (`@@unique([userAccountId, grammarTopicId])`), hier über
 * die Google-Subject-Kennung des Kontos und den fachlichen Schlüssel des
 * Themas ausgedrückt.
 *
 * `observedAt` bleibt ausdrücklich Teil des Vergleichs: Es ist der
 * Beobachtungszeitpunkt aus dem Payload (Requirement 5.3) und damit ein
 * fachlicher Feldwert, kein Zeitstempel der Datensatzpflege. Deshalb führen die
 * Round-Trip-Läufe dasselbe `submittedAt` mit (design.md,
 * "`submittedAt` ist Teil des Kontexts").
 *
 * `rawPayloadId` fällt heraus: Es zeigt auf die Herkunftszeile in
 * `RawPayload` und ist eine technische Datenbank-Kennung im Sinne von
 * Requirement 6.8. Der zweite Normalisierungslauf eines Round-Trips arbeitet
 * ohnehin auf einem anderen RawPayload; mitverglichen wäre kein Round-Trip
 * jemals gleich.
 */
export type NormalizedProgress = Omit<
  GrammarProgress,
  'id' | 'userAccountId' | 'grammarTopicId' | 'rawPayloadId' | 'createdAt' | 'updatedAt'
> & {
  readonly googleSubject: string;
  readonly topic: EntityKey;
};

/** Der normalisierte Grammatik_Katalog, Eingabe von `serializeCatalog` (Aufgabe 12.3). */
export interface NormalizedCatalogState {
  readonly categories: readonly NormalizedCategory[];
  readonly topics: readonly NormalizedTopic[];
}

/** Der normalisierte Lernstand, Eingabe von `serializeProgress` (Aufgabe 12.3). */
export interface NormalizedProgressState {
  readonly progress: readonly NormalizedProgress[];
}

/** Der vollständige normalisierte Datenbestand, Gegenstand des Vergleichs. */
export interface NormalizedState extends NormalizedCatalogState, NormalizedProgressState {}

/** Art einer Abweichung zwischen zwei Beständen. */
export type NormalizedStateDifferenceKind =
  'value' | 'missing-in-a' | 'missing-in-b' | 'duplicate-key';

/**
 * Eine einzelne Abweichung. `path` benennt die Stelle so, dass sie ohne
 * weiteres Nachsehen zu finden ist, zum Beispiel
 * `topics[["ES","grammar_topic_es_1_3"]].cefrLevel`.
 */
export interface NormalizedStateDifference {
  readonly kind: NormalizedStateDifferenceKind;
  readonly path: string;
  readonly inA: unknown;
  readonly inB: unknown;
}

/**
 * Ergebnis des Vergleichs.
 *
 * Bewusst kein bloßes `boolean`: Widerlegt ein eigenschaftsbasierter Test eine
 * Round-Trip-Eigenschaft, verlangt Requirement 10.5 ein lesbares minimiertes
 * Gegenbeispiel. `fast-check` gibt dazu die erzeugte Eingabe aus — welches Feld
 * welcher Entität auseinandergeht, weiß aber nur diese Funktion. `report` ist
 * darum auf eine Verwendungsstelle der Form
 * `expect(normalizedStateEquals(a, b).report).toBe('')` zugeschnitten: Der
 * Reporter stellt dann die Abweichung als Unterschied zwischen erwartetem und
 * beobachtetem Wert dar (Requirement 10.11).
 */
export interface NormalizedStateComparison {
  readonly equal: boolean;
  readonly differences: readonly NormalizedStateDifference[];
  /** Menschenlesbarer Bericht; leere Zeichenkette genau dann, wenn `equal`. */
  readonly report: string;
}

/** Prisma-Zeilen, aus denen ein Bestand projiziert wird. */
export interface NormalizedStateRows {
  /**
   * Nur zur Auflösung von `GrammarProgress.userAccountId` auf die
   * Google-Subject-Kennung nötig; bei leerem Lernstand entbehrlich.
   */
  readonly userAccounts?: readonly UserAccount[];
  readonly categories?: readonly GrammarCategory[];
  readonly topics?: readonly GrammarTopic[];
  readonly progress?: readonly GrammarProgress[];
}

/** Höchstzahl der im Bericht ausgeschriebenen Abweichungen. */
const MAX_REPORTED_DIFFERENCES = 10;

/**
 * Die beim Vergleich unberücksichtigten Felder, je Modell genau einmal
 * aufgeschrieben (Requirement 6.8). `satisfies` bindet die Listen an
 * `schema.prisma`: Wird ein Feld dort umbenannt oder entfernt, schlägt der
 * Type-Check hier fehl, statt die Ausnahme still unwirksam werden zu lassen.
 */
const CATEGORY_IGNORED = [
  'id',
  'firstSeenAt',
  'lastSeenInCatalogAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof GrammarCategory)[];

const TOPIC_IGNORED = [
  'id',
  'categoryId',
  'firstSeenAt',
  'lastSeenInCatalogAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof GrammarTopic)[];

const PROGRESS_IGNORED = [
  'id',
  'userAccountId',
  'grammarTopicId',
  'rawPayloadId',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof GrammarProgress)[];

/**
 * Projiziert Prisma-Zeilen auf den fachlichen Bestand: technische Kennungen
 * fallen weg, Fremdschlüssel werden zu fachlichen Schlüsseln aufgelöst.
 *
 * Eine Zeile, deren Fremdschlüssel in den übergebenen Zeilen keine
 * Entsprechung hat, ist ein Fehlgriff der Aufrufstelle — üblicherweise ein
 * vergessenes `findMany`. Die Funktion wirft dann, statt die Zuordnung auf
 * `null` fallen zu lassen: Ein stillschweigend verlorener Bezug würde den
 * Vergleich nachsichtiger machen, und das ist genau das Risiko, gegen das diese
 * Datei geschrieben ist.
 */
export function toNormalizedState(rows: NormalizedStateRows): NormalizedState {
  const googleSubjectById = new Map(
    (rows.userAccounts ?? []).map((account) => [account.id, account.googleSubject]),
  );
  const categoryKeyById = new Map(
    (rows.categories ?? []).map((category) => [category.id, entityKeyOf(category)]),
  );
  const topicKeyById = new Map((rows.topics ?? []).map((topic) => [topic.id, entityKeyOf(topic)]));

  const categories = (rows.categories ?? []).map((row) => omit(row, CATEGORY_IGNORED));

  const topics = (rows.topics ?? []).map((row) => ({
    ...omit(row, TOPIC_IGNORED),
    category:
      row.categoryId === null ? null : requireKey(categoryKeyById, row.categoryId, 'categoryId'),
  }));

  const progress = (rows.progress ?? []).map((row) => ({
    ...omit(row, PROGRESS_IGNORED),
    googleSubject: requireKey(googleSubjectById, row.userAccountId, 'userAccountId'),
    topic: requireKey(topicKeyById, row.grammarTopicId, 'grammarTopicId'),
  }));

  return { categories, topics, progress };
}

/**
 * Gibt die Zeile ohne die genannten Felder zurück.
 *
 * Bewusst über die Feldnamen statt über eine Aufzählung der zu behaltenden
 * Felder: Nur so wird ein künftig in `schema.prisma` ergänztes fachliches Feld
 * automatisch mitverglichen. Eine Positivliste wäre die Stelle, an der genau
 * das vergessen würde — und ein vergessenes Feld macht den Vergleich
 * nachsichtiger, nicht strenger.
 *
 * Die Typzusicherung ist nötig, weil `Object.fromEntries` nur
 * `Record<string, unknown>` liefert; die Feldmenge ist durch `keys` bereits
 * statisch festgelegt, `Omit<T, K>` beschreibt das Ergebnis also zutreffend.
 */
function omit<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Omit<T, K> {
  const ignored = new Set<string>(keys.map(String));

  return Object.fromEntries(Object.entries(row).filter(([field]) => !ignored.has(field))) as Omit<
    T,
    K
  >;
}

/**
 * Vergleicht zwei normalisierte Bestände nach Requirement 6.8 und benennt
 * jede Abweichung samt ihrer Stelle.
 *
 * Die Reihenfolge innerhalb der Sammlungen ist ohne Belang — verglichen werden
 * Mengen fachlicher Schlüssel. Kommt ein Schlüssel innerhalb eines Bestands
 * mehrfach vor, gilt das als Abweichung (`duplicate-key`) und nicht als
 * Überschreibung: Aus der Datenbank kann das wegen der `@@unique`-Schlüssel
 * nicht kommen, aus einem von Hand gebauten Bestand schon, und dort wäre ein
 * verschluckter Doppeleintrag eine unbemerkte Lücke im Vergleich.
 */
export function normalizedStateEquals(
  a: NormalizedState,
  b: NormalizedState,
): NormalizedStateComparison {
  const differences = [
    ...diffCollection('categories', a.categories, b.categories, categoryKey),
    ...diffCollection('topics', a.topics, b.topics, topicKey),
    ...diffCollection('progress', a.progress, b.progress, progressKey),
  ].sort((left, right) => left.path.localeCompare(right.path));

  return {
    equal: differences.length === 0,
    differences,
    report: formatReport(differences),
  };
}

/** Fachlicher Schlüssel einer Kategorie in Textform. */
export function categoryKey(category: NormalizedCategory): string {
  return stateKey([category.language, category.busuuId]);
}

/** Fachlicher Schlüssel eines Themas in Textform. */
export function topicKey(topic: NormalizedTopic): string {
  return stateKey([topic.language, topic.busuuId]);
}

/** Fachlicher Schlüssel eines Lernstands in Textform: Konto und Thema. */
export function progressKey(entry: NormalizedProgress): string {
  return stateKey([entry.googleSubject, entry.topic.language, entry.topic.busuuId]);
}

/**
 * Schlüssel mehrteiliger fachlicher Kennungen in Textform.
 *
 * `JSON.stringify` über den Bestandteilen statt einer Verkettung mit
 * Trennzeichen: Busuu-Kennungen sind unverändert übernommene Fremddaten
 * (Requirement 4.2), ein beliebiges Trennzeichen könnte darin vorkommen und
 * zwei verschiedene Entitäten auf denselben Schlüssel abbilden. Die Textform
 * bleibt trotzdem lesbar genug für den Pfad einer Abweichung.
 */
function stateKey(parts: readonly string[]): string {
  return JSON.stringify(parts);
}

function entityKeyOf(entity: { language: TargetLanguage; busuuId: string }): EntityKey {
  return { language: entity.language, busuuId: entity.busuuId };
}

function requireKey<T>(index: ReadonlyMap<string, T>, id: string, field: string): T {
  const resolved = index.get(id);

  if (resolved === undefined) {
    throw new Error(
      `Kein fachlicher Schlüssel für ${field} "${id}": Die übergebenen Zeilen enthalten die ` +
        'verwiesene Entität nicht. Der Bestand muss vollständig übergeben werden, sonst ist der ' +
        'Vergleich nach Requirement 6.8 nicht aussagekräftig.',
    );
  }

  return resolved;
}

function diffCollection<T>(
  collection: string,
  a: readonly T[],
  b: readonly T[],
  keyOf: (entity: T) => string,
): NormalizedStateDifference[] {
  const differences: NormalizedStateDifference[] = [];
  const indexA = indexByKey(collection, a, keyOf, 'a', differences);
  const indexB = indexByKey(collection, b, keyOf, 'b', differences);

  for (const [key, entityA] of indexA) {
    const entityB = indexB.get(key);

    if (entityB === undefined) {
      differences.push({
        kind: 'missing-in-b',
        path: pathOf(collection, key),
        inA: entityA,
        inB: undefined,
      });
      continue;
    }

    diffValues(pathOf(collection, key), entityA, entityB, differences);
  }

  for (const [key, entityB] of indexB) {
    if (!indexA.has(key)) {
      differences.push({
        kind: 'missing-in-a',
        path: pathOf(collection, key),
        inA: undefined,
        inB: entityB,
      });
    }
  }

  return differences;
}

function indexByKey<T>(
  collection: string,
  entities: readonly T[],
  keyOf: (entity: T) => string,
  side: 'a' | 'b',
  differences: NormalizedStateDifference[],
): Map<string, T> {
  const index = new Map<string, T>();

  for (const entity of entities) {
    const key = keyOf(entity);

    if (index.has(key)) {
      differences.push({
        kind: 'duplicate-key',
        path: pathOf(collection, key),
        inA: side === 'a' ? entity : undefined,
        inB: side === 'b' ? entity : undefined,
      });
      continue;
    }

    index.set(key, entity);
  }

  return index;
}

function pathOf(collection: string, key: string): string {
  return `${collection}[${key}]`;
}

/**
 * Vergleicht zwei Werte gleicher Herkunft strukturell und schreibt jede
 * Abweichung mit ihrem Pfad fort. Über die Vereinigung der Feldnamen, damit ein
 * Feld, das nur auf einer Seite gesetzt ist, nicht durchfällt.
 */
function diffValues(
  path: string,
  a: unknown,
  b: unknown,
  differences: NormalizedStateDifference[],
): void {
  if (a instanceof Date || b instanceof Date) {
    const timeA = a instanceof Date ? a.getTime() : a;
    const timeB = b instanceof Date ? b.getTime() : b;

    if (!Object.is(timeA, timeB)) {
      differences.push({ kind: 'value', path, inA: a, inB: b });
    }

    return;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    for (let position = 0; position < Math.max(a.length, b.length); position += 1) {
      diffValues(`${path}[${position}]`, a[position], b[position], differences);
    }

    return;
  }

  if (!isPlainRecord(a) || !isPlainRecord(b)) {
    if (!Object.is(a, b)) {
      differences.push({ kind: 'value', path, inA: a, inB: b });
    }

    return;
  }

  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    diffValues(`${path}.${field}`, a[field], b[field], differences);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatReport(differences: readonly NormalizedStateDifference[]): string {
  if (differences.length === 0) {
    return '';
  }

  const shown = differences.slice(0, MAX_REPORTED_DIFFERENCES);
  const lines = shown.map(
    (difference) =>
      `  ${difference.path} (${difference.kind}): a = ${formatValue(difference.inA)}, ` +
      `b = ${formatValue(difference.inB)}`,
  );

  if (differences.length > shown.length) {
    lines.push(`  … und ${differences.length - shown.length} weitere`);
  }

  return [
    `${differences.length} Abweichung(en) zwischen den normalisierten Beständen:`,
    ...lines,
  ].join('\n');
}

function formatValue(value: unknown): string {
  if (value === undefined) {
    return '(nicht vorhanden)';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return JSON.stringify(value);
}
