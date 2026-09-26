import { SentenzaError, SentenzaErrorCode, TargetLanguage } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../common/logger.js';
import { resolveTargetLanguage } from '../resolve-target-language.js';

/**
 * Ableitung der Zielsprache aus der Katalog-Kennung (Aufgabe 10.1; Requirement
 * 4.1, 4.16).
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Funktion
 * entscheidet allein über ihrer Eingabe, der Logger ist durch eine Senke in ein
 * Array ersetzt. Damit ist auch die Zusage aus Requirement 4.16 geprüft, dass
 * ein Fehlschlag keine Entität anlegt oder ändert — es gibt nichts, was die
 * Funktion schreiben könnte.
 *
 * Der eigenschaftsbasierte Test zu Property 13 gehört in diese Datei — je
 * Quelldatei gibt es genau eine Testdatei.
 */

/**
 * Kennung des echten Katalog-Payloads, zeichengleich aus
 * `fixtures/busuu/grammar-review-es.json` (Feld `id`) übernommen.
 */
const REAL_CATALOG_ID = 'grammar_review_es';

function loggerCollecting(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    component: 'busuu',
    level: 'debug',
    sink: (line) => lines.push(line),
  });

  return { logger, lines };
}

function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Löst auf und hält fest, dass dabei nichts protokolliert wurde. */
function resolvedQuietly(catalogId: string): TargetLanguage {
  const { logger, lines } = loggerCollecting();
  const language = resolveTargetLanguage(catalogId, logger);

  expect(lines).toEqual([]);

  return language;
}

/** Fängt den Abbruch und gibt ihn zur weiteren Prüfung zurück. */
function rejectionOf(catalogId: string): SentenzaError {
  const { logger, lines } = loggerCollecting();
  let caught: unknown;

  try {
    resolveTargetLanguage(catalogId, logger);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SentenzaError);
  // design.md, Abschnitt "Error Handling": nicht unterstützte Zielsprache
  // ergibt genau `BAD_USER_INPUT`.
  expect((caught as SentenzaError).code).toBe(SentenzaErrorCode.BAD_USER_INPUT);
  // Requirement 4.16: Die Meldung benennt die nicht auflösbare Kennung.
  expect((caught as SentenzaError).message).toContain(catalogId);
  // Der Abbruch ist immer nachvollziehbar protokolliert, und das ist zugleich
  // die vollständige Liste seiner Wirkungen.
  const entries = logEntries(lines);
  expect(entries).toHaveLength(1);
  expect(entries[0]?.step).toBe('busuu.catalog.language');

  return caught as SentenzaError;
}

describe('resolveTargetLanguage', () => {
  describe('leitet die Zielsprache aus dem Segment hinter dem letzten Unterstrich ab', () => {
    it('bei der Kennung des echten Katalog-Payloads', () => {
      // Requirement 4.1: `grammar_review_es` ergibt `es`.
      expect(resolvedQuietly(REAL_CATALOG_ID)).toBe(TargetLanguage.ES);
    });

    it('unabhängig von der Groß- und Kleinschreibung', () => {
      // Requirement 4.1: Die Schreibweise bleibt unbeachtet.
      expect(resolvedQuietly('GRAMMAR_REVIEW_ES')).toBe(TargetLanguage.ES);
      expect(resolvedQuietly('grammar_review_Es')).toBe(TargetLanguage.ES);
      expect(resolvedQuietly('Grammar_Review_eS')).toBe(TargetLanguage.ES);
    });

    it('bei mehreren Unterstrichen allein aus dem letzten Segment', () => {
      expect(resolvedQuietly('grammar_review_beta_2_es')).toBe(TargetLanguage.ES);
      // Ein Unterstrich genügt, auch ohne weiteren Kontext davor.
      expect(resolvedQuietly('_es')).toBe(TargetLanguage.ES);
    });
  });

  describe('bricht mit BAD_USER_INPUT ab und nennt die Kennung', () => {
    it('bei einem nicht unterstützten Sprach-Code', () => {
      // Requirement 4.16: `TargetLanguage` kennt derzeit nur `ES`.
      const error = rejectionOf('grammar_review_fr');

      expect(error.message).toBe(
        'Die Katalog-Kennung "grammar_review_fr" enthält keinen von Sentenza unterstützten Sprach-Code.',
      );
      // Requirement 9.3: keine internen Details in der Antwort.
      expect(error.details).toBeUndefined();
    });

    it('bei einer Kennung ohne Unterstrich', () => {
      // Ohne Unterstrich gibt es kein Segment dahinter — auch dann nicht, wenn
      // die Kennung selbst wie ein Sprach-Code aussieht.
      rejectionOf('grammarreviewes');
      rejectionOf('es');
      rejectionOf('ES');
    });

    it('bei einer leeren Kennung', () => {
      const error = rejectionOf('');

      expect(error.message).toBe(
        'Die Katalog-Kennung "" enthält keinen von Sentenza unterstützten Sprach-Code.',
      );
    });

    it('bei einem leeren Segment hinter dem letzten Unterstrich', () => {
      rejectionOf('grammar_review_');
      rejectionOf('grammar_review_es_');
      rejectionOf('_');
    });

    it('wenn der Sprach-Code nicht im letzten Segment steht', () => {
      // Entscheidend ist ausschließlich der letzte Unterstrich; ein früheres
      // Vorkommen zählt nicht.
      rejectionOf('grammar_es_review');
      rejectionOf('grammar_review_es_beta');
    });

    it('bei abweichender Zeichenfolge im Segment jenseits der Schreibweise', () => {
      // Requirement 4.1 lässt allein die Groß- und Kleinschreibung unbeachtet:
      // Leerzeichen, Zusätze und abweichende Zeichen treffen nicht.
      rejectionOf('grammar_review_ es');
      rejectionOf('grammar_review_es ');
      rejectionOf('grammar_review_esp');
      rejectionOf('grammar_review_e');
    });

    it('protokolliert Kennung, Segment und die unterstützten Sprach-Codes', () => {
      const { logger, lines } = loggerCollecting();

      expect(() => resolveTargetLanguage('grammar_review_pt', logger)).toThrow(SentenzaError);

      const [entry] = logEntries(lines);
      expect(entry?.level).toBe('warn');
      expect(entry?.component).toBe('busuu');
      expect(entry?.reason).toBe('unsupported-language-code');
      expect(entry?.catalogId).toBe('grammar_review_pt');
      expect(entry?.languageCode).toBe('pt');
      expect(entry?.supportedLanguageCodes).toEqual(Object.values(TargetLanguage));
    });

    it('kürzt eine überlange Kennung in der Meldung, nennt sie im Protokoll aber vollständig', () => {
      // Requirement 3.5 begrenzt die am Eintrag hinterlegte Fehlermeldung auf
      // 2.000 Zeichen; der erklärende Teil muss darin lesbar bleiben.
      const catalogId = `${'x'.repeat(300)}_fr`;
      const { logger, lines } = loggerCollecting();
      let caught: unknown;

      try {
        resolveTargetLanguage(catalogId, logger);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(SentenzaError);
      expect((caught as SentenzaError).message).toBe(
        `Die Katalog-Kennung "${'x'.repeat(200)}…" enthält keinen von Sentenza unterstützten Sprach-Code.`,
      );
      expect(logEntries(lines)[0]?.catalogId).toBe(catalogId);
    });
  });
});
