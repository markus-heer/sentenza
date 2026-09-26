import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../common/logger.js';
import { assertEmailAllowed } from '../assert-email-allowed.js';

/**
 * Prüfung gegen die Konto_Freigabeliste (Aufgabe 6.3; Requirement 2.4, 2.9).
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Funktion
 * entscheidet allein über ihren beiden Eingaben, der Logger ist durch eine
 * Senke in ein Array ersetzt.
 *
 * Der eigenschaftsbasierte Test zu Property 25 gehört in diese Datei — je
 * Quelldatei gibt es genau eine Testdatei.
 */

/** Freigabeliste in der Form, die `loadConfig` liefert: getrimmt, ohne leere Einträge. */
const ALLOWED = ['nutzer@example.com', 'Zweitkonto@Example.COM'];

function loggerCollecting(): { logger: ReturnType<typeof createLogger>; lines: string[] } {
  const lines: string[] = [];
  const logger = createLogger({
    component: 'auth',
    level: 'debug',
    sink: (line) => lines.push(line),
  });

  return { logger, lines };
}

function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Fängt die Ablehnung und gibt sie zur weiteren Prüfung zurück. */
function rejectionOf(email: string, allowedEmails: readonly string[]): SentenzaError {
  const { logger, lines } = loggerCollecting();
  let caught: unknown;

  try {
    assertEmailAllowed(email, allowedEmails, logger);
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(SentenzaError);
  // Requirement 2.4: genau `FORBIDDEN`, nicht `UNAUTHENTICATED`.
  expect((caught as SentenzaError).code).toBe(SentenzaErrorCode.FORBIDDEN);
  // Die Ablehnung ist immer nachvollziehbar protokolliert.
  expect(logEntries(lines)[0]?.step).toBe('auth.allowlist');

  return caught as SentenzaError;
}

describe('assertEmailAllowed', () => {
  describe('lässt eine freigegebene Adresse durch', () => {
    it('bei zeichengleicher Übereinstimmung', () => {
      const { logger, lines } = loggerCollecting();

      expect(assertEmailAllowed('nutzer@example.com', ALLOWED, logger)).toBeUndefined();
      expect(lines).toEqual([]);
    });

    it('unabhängig von der Groß- und Kleinschreibung auf beiden Seiten', () => {
      const { logger } = loggerCollecting();

      // Requirement 2.4: Vergleich in Kleinbuchstaben. Links abweichend
      // geschrieben, rechts abweichend geschrieben, beides zugleich.
      expect(() => assertEmailAllowed('NUTZER@EXAMPLE.COM', ALLOWED, logger)).not.toThrow();
      expect(() => assertEmailAllowed('zweitkonto@example.com', ALLOWED, logger)).not.toThrow();
      expect(() => assertEmailAllowed('ZweitKonto@example.COM', ALLOWED, logger)).not.toThrow();
    });

    it('unabhängig von umgebenden Leerzeichen auf beiden Seiten', () => {
      const { logger } = loggerCollecting();

      // Requirement 2.4: Vergleich ohne umgebende Leerzeichen. Die Liste
      // enthält hier ungetrimmte Einträge, wie sie eine von Hand gepflegte
      // `AUTH_ALLOWED_EMAILS` liefern könnte.
      expect(() => assertEmailAllowed('  nutzer@example.com\t', ALLOWED, logger)).not.toThrow();
      expect(() =>
        assertEmailAllowed('nutzer@example.com', [' nutzer@example.com '], logger),
      ).not.toThrow();
    });
  });

  describe('lehnt eine nicht freigegebene Adresse mit FORBIDDEN ab', () => {
    it('bei einer Adresse, die nicht in der Liste steht', () => {
      const error = rejectionOf('fremder@example.com', ALLOWED);

      expect(error.message).toBe('Dieses Google-Konto ist für Sentenza nicht freigegeben.');
      // Requirement 9.3: keine internen Details in der Antwort.
      expect(error.details).toBeUndefined();
    });

    it('bei leerer Freigabeliste', () => {
      // Ohne gesetzte `AUTH_ALLOWED_EMAILS` erhält kein Konto Zugang.
      rejectionOf('nutzer@example.com', []);
    });

    it('bei einer Adresse, die nur Teil eines Eintrags ist', () => {
      // Der Vergleich ist Gleichheit, nicht Enthaltensein: weder ein längerer
      // Eintrag noch ein längerer Kandidat darf treffen.
      rejectionOf('utzer@example.com', ALLOWED);
      rejectionOf('nutzer@example.com.evil.example', ALLOWED);
      rejectionOf('example.com', ALLOWED);
    });

    it('bei einer Adresse, deren innere Leerzeichen den Unterschied machen', () => {
      // `trim()` entfernt nur umgebende Leerzeichen; innen bleibt der
      // Unterschied bestehen.
      rejectionOf('nutzer @example.com', ALLOWED);
    });

    it('bei einer leeren Adresse, auch gegen eine Liste aus lauter Leerzeichen', () => {
      // Leere Einträge werden verworfen, sonst wäre eine leere Adresse
      // freigegeben. `loadConfig` liefert ohnehin keine.
      rejectionOf('', ALLOWED);
      rejectionOf('   ', ['   ', '']);
    });

    it('protokolliert die verglichene Adresse und die Größe der Liste', () => {
      const { logger, lines } = loggerCollecting();

      expect(() => assertEmailAllowed('  Fremder@Example.COM ', ALLOWED, logger)).toThrow(
        SentenzaError,
      );

      const [entry] = logEntries(lines);
      expect(entry?.level).toBe('warn');
      expect(entry?.component).toBe('auth');
      expect(entry?.reason).toBe('not-allowlisted');
      expect(entry?.email).toBe('fremder@example.com');
      expect(entry?.allowedEmailCount).toBe(ALLOWED.length);
    });
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 25: Die Freigabeliste entscheidet
 * über den Zugang.
 *
 * **Validates: Requirements 2.4**
 *
 * Geprüft wird die Entscheidung als reine Funktion über einer breiten Menge
 * erzeugter Paare aus Konto_Freigabeliste und E-Mail-Adresse. Weil die Aussage
 * eine Äquivalenz ist („genau dann“), erreicht der Generator beide Richtungen:
 * Adressen, die in der Liste stehen — in erzeugter abweichender Schreibweise
 * und mit erzeugten umgebenden Leerzeichen auf beiden Seiten, auch auf Seite
 * der Listeneinträge —, und Adressen, die nicht darin stehen: fremde Adressen,
 * Teiltreffer in beide Richtungen (der Kandidat ist ein Stück eines Eintrags,
 * ein Eintrag ist der Anfang des Kandidaten), Adressen mit Leerzeichen im
 * Inneren, die leere Adresse und die leere Liste.
 *
 * Die Erwartung berechnet der Test selbst aus der Aussage der Anforderung:
 * Vergleichsform auf beiden Seiten, leere Einträge verworfen. Letzteres
 * spiegelt die Entscheidung der Implementierung — ohne diese Verwerfung wäre
 * eine leere Adresse gegen eine Liste aus lauter Leerzeichen freigegeben.
 * Damit die berechnete Erwartung nicht stillschweigend nur eine Richtung
 * erreicht, prüft jeder Durchlauf zusätzlich die nach Konstruktion bekannte
 * Richtung seiner Lage.
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Funktion
 * kennt als Mitspieler allein den übergebenen Logger, hier eine Senke in ein
 * Array. Die Zusagen „kein Benutzerkonto angelegt“ und „kein Token
 * ausgestellt“ sind damit strukturell erfüllt — die Funktion kennt weder
 * Prisma noch die Tokenausstellung; der Test hält das fest, indem er je
 * Durchlauf die vollständige Liste der Protokolleinträge prüft. Ausstellung
 * und Kontoanlage liegen in `AuthService` (Property 26, 27).
 */

/**
 * Adressen, aus denen Freigabeliste und Kandidat gebildet werden. Reines
 * ASCII, damit Groß- und Kleinschreibung längentreu bleibt, und bewusst so
 * gewählt, dass keine dieser Adressen Teilzeichenkette einer anderen ist:
 * Sonst könnte ein erzeugter Teiltreffer versehentlich eine andere Adresse des
 * Vorrats treffen.
 */
const BASE_EMAILS = [
  'nutzer@example.com',
  'maria.lopez@example.com',
  'lerner+busuu@gmail.com',
  'markus@sentenza.test',
  'ana@b.co',
] as const;

/** Adressen, die in keiner erzeugten Liste vorkommen, weil sie nicht im Vorrat stehen. */
const FOREIGN_EMAILS = [
  'fremder@example.com',
  'angreifer@evil.example',
  'niemand@sentenza.test',
] as const;

/** Nachricht der Ablehnung; sie nennt die Adresse und die Liste nicht (Requirement 9.3). */
const FORBIDDEN_MESSAGE = 'Dieses Google-Konto ist für Sentenza nicht freigegeben.';

/**
 * Schreibweise einer Adresse: je Zeichen groß oder klein. Stellen jenseits der
 * erzeugten Länge bleiben klein, sodass auch die zeichengleiche Schreibweise
 * vorkommt.
 */
type Spelling = readonly boolean[];

const spellingArb: fc.Arbitrary<Spelling> = fc.array(fc.boolean(), { maxLength: 30 });

function respell(value: string, spelling: Spelling): string {
  return [...value]
    .map((char, index) => (spelling[index] === true ? char.toUpperCase() : char.toLowerCase()))
    .join('');
}

/**
 * Umgebende Leerzeichen. Ausschließlich Zeichen, die `trim()` zweifelsfrei
 * entfernt — ein geschütztes Leerzeichen würde die Aussage über `trim()` von
 * Feinheiten der Laufzeit abhängig machen.
 */
const paddingArb: fc.Arbitrary<string> = fc.string({
  unit: fc.constantFrom(' ', '\t', '\n', '\r'),
  maxLength: 3,
});

/** Ein Eintrag der Freigabeliste: die Adresse samt ihrer erzeugten Entstellung. */
interface AllowlistEntry {
  readonly email: string;
  readonly spelling: Spelling;
  readonly left: string;
  readonly right: string;
}

const entryArb: fc.Arbitrary<AllowlistEntry> = fc.record({
  email: fc.constantFrom(...BASE_EMAILS),
  spelling: spellingArb,
  left: paddingArb,
  right: paddingArb,
});

/** Lage des Kandidaten zur Liste. */
type CandidateKind =
  | 'member'
  | 'pool'
  | 'foreign'
  | 'shortened-entry'
  | 'extended-entry'
  | 'inner-whitespace'
  | 'blank';

const CANDIDATE_KINDS: readonly CandidateKind[] = [
  'member',
  'pool',
  'foreign',
  'shortened-entry',
  'extended-entry',
  'inner-whitespace',
  'blank',
];

/** Lagen, in denen der Kandidat nach Konstruktion in der Liste steht. */
const LISTED_KINDS = new Set<CandidateKind>(['member']);

/**
 * Lagen, in denen er nach Konstruktion nicht darin stehen kann. `pool` fehlt
 * hier absichtlich: Dort stammt die Adresse aus demselben Vorrat wie die
 * Einträge, und erst die berechnete Erwartung entscheidet.
 */
const UNLISTED_KINDS = new Set<CandidateKind>([
  'foreign',
  'shortened-entry',
  'extended-entry',
  'inner-whitespace',
  'blank',
]);

/** Ein erzeugter Ablauf: die Liste, der Kandidat und seine Lage dazu. */
interface Scenario {
  readonly kind: CandidateKind;
  readonly allowedEmails: readonly string[];
  readonly email: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    kind: fc.constantFrom(...CANDIDATE_KINDS),
    // Ohne Mindestlänge: die leere Freigabeliste ist eine der geprüften Lagen.
    entries: fc.uniqueArray(entryArb, {
      selector: (entry) => entry.email,
      maxLength: BASE_EMAILS.length,
    }),
    blankEntries: fc.array(fc.constantFrom('', ' ', '\t', '   '), { maxLength: 3 }),
    poolEmail: fc.constantFrom(...BASE_EMAILS),
    foreignEmail: fc.constantFrom(...FOREIGN_EMAILS),
    entryIndex: fc.nat(),
    spelling: spellingArb,
    left: paddingArb,
    right: paddingArb,
    cutFront: fc.integer({ min: 0, max: 2 }),
    cutBack: fc.integer({ min: 0, max: 2 }),
    prefix: fc.constantFrom('', 'x', 'pre.'),
    suffix: fc.constantFrom('', '.evil.example', 'x'),
    innerOffset: fc.nat(),
    innerWhitespace: fc.constantFrom(' ', '\t', '  '),
    blankValue: fc.constantFrom('', ' ', '\t\n'),
  })
  .map((generated) => {
    const allowedEmails = [
      ...generated.entries.map(
        (entry) => `${entry.left}${respell(entry.email, entry.spelling)}${entry.right}`,
      ),
      ...generated.blankEntries,
    ];

    const listed =
      generated.entries.length === 0
        ? undefined
        : generated.entries[generated.entryIndex % generated.entries.length]!.email;
    // Abgeleitete Lagen brauchen eine Vorlage. Ist die Liste leer, tritt eine
    // Adresse des Vorrats an ihre Stelle; die Vorlage steht dann in keiner
    // Liste, was die Aussage der Lage nicht ändert.
    const source = listed ?? generated.poolEmail;

    let kind = generated.kind;
    let raw: string;

    switch (kind) {
      case 'member':
        if (listed === undefined) {
          // Bei leerer Liste gibt es kein Mitglied; der Kandidat wird zur
          // gewöhnlichen Adresse des Vorrats und damit abgelehnt.
          kind = 'pool';
          raw = generated.poolEmail;
        } else {
          raw = listed;
        }
        break;
      case 'pool':
        raw = generated.poolEmail;
        break;
      case 'foreign':
        raw = generated.foreignEmail;
        break;
      case 'shortened-entry': {
        // Teiltreffer, Richtung 1: Der Kandidat ist ein Stück eines Eintrags.
        // Mindestens ein Zeichen fällt weg, sonst wäre es keine Verkürzung.
        const cutBack = generated.cutFront === 0 && generated.cutBack === 0 ? 1 : generated.cutBack;
        raw = source.slice(generated.cutFront, source.length - cutBack);
        break;
      }
      case 'extended-entry': {
        // Teiltreffer, Richtung 2: Ein Eintrag steckt im Kandidaten.
        const both = generated.prefix === '' && generated.suffix === '';
        raw = `${generated.prefix}${source}${both ? '.evil.example' : generated.suffix}`;
        break;
      }
      case 'inner-whitespace': {
        // Streng innen: `trim()` entfernt nur umgebende Leerzeichen, dieses
        // hier bleibt und unterscheidet den Kandidaten vom Eintrag.
        const at = 1 + (generated.innerOffset % (source.length - 1));
        raw = `${source.slice(0, at)}${generated.innerWhitespace}${source.slice(at)}`;
        break;
      }
      case 'blank':
        raw = generated.blankValue;
        break;
    }

    return {
      kind,
      allowedEmails,
      email: `${generated.left}${respell(raw, generated.spelling)}${generated.right}`,
    };
  });

/** Vergleichsform nach Requirement 2.4, unabhängig von der Implementierung formuliert. */
const comparable = (value: string) => value.trim().toLowerCase();

describe('assertEmailAllowed (Property 25)', () => {
  it('lässt eine Adresse genau dann durch, wenn sie in der gleichermaßen normalisierten Freigabeliste steht, und lehnt sie andernfalls mit FORBIDDEN ab', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const listed = new Set(
          scenario.allowedEmails.map(comparable).filter((entry) => entry.length > 0),
        );
        const expectedAllowed = listed.has(comparable(scenario.email));

        // Der Generator erreicht beide Richtungen und nicht nur eine davon.
        if (LISTED_KINDS.has(scenario.kind)) {
          expect(expectedAllowed).toBe(true);
        } else if (UNLISTED_KINDS.has(scenario.kind)) {
          expect(expectedAllowed).toBe(false);
        }

        const { logger, lines } = loggerCollecting();
        let returned: unknown;
        let thrown: unknown;

        try {
          returned = assertEmailAllowed(scenario.email, scenario.allowedEmails, logger);
        } catch (error) {
          thrown = error;
        }

        if (expectedAllowed) {
          // Richtung 1: Ein Treffer in Vergleichsform lässt die Anmeldung und
          // jede Erneuerung zu, still und ohne Rückgabewert.
          expect(thrown).toBeUndefined();
          expect(returned).toBeUndefined();
          expect(lines).toEqual([]);
          return;
        }

        // Richtung 2: Jede andere Adresse wird mit genau `FORBIDDEN`
        // abgelehnt, niemals mit einem anderen Fehlercode.
        expect(thrown).toBeInstanceOf(SentenzaError);
        const error = thrown as SentenzaError;
        expect(error.code).toBe(SentenzaErrorCode.FORBIDDEN);
        expect(error.message).toBe(FORBIDDEN_MESSAGE);
        // Requirement 9.3: keine internen Details in der Antwort.
        expect(error.details).toBeUndefined();

        // Genau ein Protokolleintrag, und dies ist zugleich die vollständige
        // Liste der Wirkungen des Aufrufs: Es gibt keine Kontoanlage und keine
        // Tokenausstellung, die stattfinden könnte.
        const entries = logEntries(lines);
        expect(entries).toHaveLength(1);
        expect(entries[0]?.level).toBe('warn');
        expect(entries[0]?.step).toBe('auth.allowlist');
        expect(entries[0]?.reason).toBe('not-allowlisted');
        expect(entries[0]?.email).toBe(comparable(scenario.email));
        expect(entries[0]?.allowedEmailCount).toBe(listed.size);
      }),
      { numRuns: 100 },
    );
  });
});
