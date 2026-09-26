import { SentenzaError, SentenzaErrorCode, TargetLanguage } from '@sentenza/domain';

import { createLogger, type SentenzaLogger } from '../../common/logger.js';

/**
 * Trennzeichen der Katalog-Kennung. Der Sprach-Code ist das Segment hinter dem
 * **letzten** Vorkommen (Requirement 4.1; design.md, Abschnitt "Zielsprache"):
 * `grammar_review_es` ergibt `es`, und bei mehreren Unterstrichen entscheidet
 * ausschließlich der letzte.
 */
const SEGMENT_SEPARATOR = '_';

/**
 * Zulässige Sprach-Codes in Vergleichsform, abgeleitet aus `TargetLanguage`.
 *
 * Bewusst aus der Enumeration erzeugt und nicht erneut aufgeschrieben: Die
 * Menge der „von Sentenza unterstützten Zielsprachen" (Requirement 4.16) ist
 * genau die Enumeration. Ein zusätzlicher Wert dort wirkt damit hier, ohne
 * dass diese Datei anzufassen wäre.
 */
const LANGUAGE_BY_CODE = new Map<string, TargetLanguage>(
  Object.values(TargetLanguage).map((language) => [language.toUpperCase(), language]),
);

/**
 * Obergrenze der in der Fehlermeldung genannten Kennung. Requirement 4.4 lässt
 * Busuu-Kennungen bis 200 Zeichen zu; die Meldung eines Fehlschlags wird nach
 * Requirement 3.5 mit höchstens 2.000 Zeichen am Eintrag des
 * Raw_Payload_Store hinterlegt. Die Begrenzung hält den erklärenden Teil der
 * Meldung auch dann lesbar, wenn ein Payload eine überlange Kennung mitbringt.
 */
const MAX_QUOTED_ID_LENGTH = 200;

/** Kennung in der Form, in der sie in der Fehlermeldung erscheint. */
function quoteCatalogId(catalogId: string): string {
  return catalogId.length <= MAX_QUOTED_ID_LENGTH
    ? catalogId
    : `${catalogId.slice(0, MAX_QUOTED_ID_LENGTH)}…`;
}

/**
 * Nachricht des Abbruchs nach Requirement 4.16: Sie benennt die nicht
 * auflösbare Katalog-Kennung. Die Kennung stammt aus dem eingereichten Payload
 * und ist damit kein internes Detail im Sinne von Requirement 9.3 — ohne sie
 * wäre nicht zu erkennen, welcher Payload abgelehnt wurde.
 */
function unsupportedLanguageMessage(catalogId: string): string {
  return `Die Katalog-Kennung "${quoteCatalogId(catalogId)}" enthält keinen von Sentenza unterstützten Sprach-Code.`;
}

/**
 * Ableitung der Zielsprache aus der Katalog-Kennung (Requirement 4.1, 4.16;
 * design.md, Abschnitt "Zielsprache").
 *
 * Der Sprach-Code ist das Segment hinter dem letzten Unterstrich der Kennung.
 * Verglichen wird ohne Beachtung der Groß- und Kleinschreibung, aber sonst
 * zeichengenau: Umgebende Leerzeichen werden nicht entfernt, weil Requirement
 * 4.1 allein die Schreibweise unbeachtet lässt und die Kennungen des Payloads
 * ansonsten unverändert übernommen werden (Requirement 4.4).
 *
 * Enthält die Kennung keinen Unterstrich, gibt es kein Segment hinter einem
 * letzten Unterstrich — auch dieser Fall bricht ab. Eine Kennung wie `es`
 * gilt also nicht als Sprach-Code; ein Katalog-Payload trägt seine Sprache
 * laut Requirement 4.1 im Suffix einer zusammengesetzten Kennung.
 *
 * Kein Treffer ⇒ `SentenzaError` mit `BAD_USER_INPUT` (design.md, Abschnitt
 * "Error Handling": nicht unterstützte Zielsprache ⇒ `BAD_USER_INPUT`). Die
 * Zusage aus Requirement 4.16, dass dabei keine Grammatik_Kategorie und kein
 * Grammatik_Thema angelegt oder geändert wird, ist strukturell erfüllt: Die
 * Funktion kennt weder Prisma noch eine Transaktion und kann daher nichts
 * schreiben. Die Aufrufstelle in `catalog.normalizer.ts` leitet die
 * Zielsprache vor dem ersten Schreibvorgang ab.
 *
 * Trägt absichtlich kein `@Injectable()` und ist bewusst eine Funktion über
 * ihrer Eingabe statt ein Provider: So ist die Ableitung ohne laufende
 * Nest-Anwendung und ohne Datenbank prüfbar (Property 13).
 *
 * @param catalogId Kennung des Katalog-Payloads, unverändert aus dem Feld `id`
 *   übernommen (Beispiel: `grammar_review_es`).
 * @returns Die Zielsprache, der alle Entitäten desselben Vorgangs zugeordnet
 *   werden (Requirement 4.1).
 */
export function resolveTargetLanguage(
  catalogId: string,
  logger: SentenzaLogger = createLogger({ component: 'busuu' }),
): TargetLanguage {
  const separatorAt = catalogId.lastIndexOf(SEGMENT_SEPARATOR);
  const languageCode = separatorAt === -1 ? '' : catalogId.slice(separatorAt + 1);
  const language = LANGUAGE_BY_CODE.get(languageCode.toUpperCase());

  if (language !== undefined) {
    return language;
  }

  // Die beanstandete Kennung steht zusätzlich im Protokoll: Sie ist der
  // einzige Anhaltspunkt, um ein geändertes Busuu-Format von einem schlicht
  // nicht unterstützten Sprach-Code zu unterscheiden.
  logger.warn('Katalog-Kennung ohne unterstützten Sprach-Code', {
    step: 'busuu.catalog.language',
    reason: 'unsupported-language-code',
    catalogId,
    languageCode,
    supportedLanguageCodes: [...LANGUAGE_BY_CODE.keys()],
  });

  throw new SentenzaError(SentenzaErrorCode.BAD_USER_INPUT, unsupportedLanguageMessage(catalogId));
}
