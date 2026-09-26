import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';

import { createLogger, type SentenzaLogger } from '../common/logger.js';

/**
 * Nachricht der Ablehnung eines nicht freigegebenen Kontos (Requirement 2.4).
 *
 * Bewusst ohne die beanstandete Adresse und ohne einen Hinweis darauf, wie die
 * Freigabeliste aussieht: Die Antwort an den Client nennt keine internen
 * Details (Requirement 9.3). Wer die Liste pflegen darf, findet den Grund im
 * Protokolleintrag.
 */
const FORBIDDEN_MESSAGE = 'Dieses Google-Konto ist für Sentenza nicht freigegeben.';

/**
 * Vergleichsform einer E-Mail-Adresse: ohne umgebende Leerzeichen und klein
 * geschrieben (Requirement 2.4; design.md, Abschnitt "Freigabeliste").
 *
 * Dieselbe Form gilt auf beiden Seiten des Vergleichs — für die Adresse aus
 * dem Google_ID_Token wie für jeden Eintrag der Konto_Freigabeliste. Eine
 * Normalisierung nur auf einer Seite würde gerade die Schreibweisen
 * durchlassen, gegen die sie gedacht ist.
 */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Prüfung gegen die Konto_Freigabeliste (Requirement 2.4; design.md,
 * Abschnitt "Freigabeliste").
 *
 * Ein Treffer ist Voraussetzung sowohl für die Anmeldung als auch für jede
 * Erneuerung (Requirement 2.9) — deshalb ist dies eine eigene Funktion und
 * keine Zeile in `signInWithGoogle`: Ein nachträgliches Entfernen aus der
 * Liste wirkt damit spätestens beim nächsten Erneuern.
 *
 * Die Funktion gibt bei einem Treffer nichts zurück und wirft andernfalls
 * `SentenzaError` mit `FORBIDDEN`. Die Zusagen „kein Benutzerkonto angelegt"
 * und „kein Token ausgestellt" ergeben sich daraus, dass die Aufrufstelle sie
 * vor jedem `upsert` und vor jeder Tokenausstellung aufruft; die Funktion
 * selbst kennt weder Prisma noch die Tokenausstellung und kann daher nichts
 * anlegen.
 *
 * Leere Einträge der Liste werden verworfen. `loadConfig` liefert ohnehin
 * keine — dort filtert `AUTH_ALLOWED_EMAILS` leere Segmente heraus —, und ohne
 * diese Verwerfung wäre eine leere Adresse gegen eine Liste aus lauter
 * Leerzeichen freigegeben.
 *
 * Trägt absichtlich kein `@Injectable()` und ist bewusst eine Funktion über
 * ihren Eingaben statt ein Provider: So ist die Entscheidung ohne laufende
 * Nest-Anwendung und ohne Datenbank prüfbar (Property 25).
 *
 * @param email Adresse aus dem geprüften Google_ID_Token beziehungsweise die
 *   am Benutzerkonto gespeicherte Adresse bei einer Erneuerung. Unverändert
 *   übergeben; die Vergleichsform entsteht hier.
 * @param allowedEmails Die Konto_Freigabeliste, üblicherweise
 *   `config.auth.allowedEmails`.
 */
export function assertEmailAllowed(
  email: string,
  allowedEmails: readonly string[],
  logger: SentenzaLogger = createLogger({ component: 'auth' }),
): void {
  const normalizedEmail = normalizeEmail(email);
  const allowed = new Set(allowedEmails.map(normalizeEmail).filter((entry) => entry.length > 0));

  if (allowed.has(normalizedEmail)) {
    return;
  }

  // Die beanstandete Adresse steht im Protokoll, nicht in der Antwort: Ohne
  // sie wäre eine zu eng geratene Freigabeliste nicht zu finden.
  logger.warn('Google-Konto nicht in der Konto_Freigabeliste', {
    step: 'auth.allowlist',
    reason: 'not-allowlisted',
    email: normalizedEmail,
    allowedEmailCount: allowed.size,
  });

  throw new SentenzaError(SentenzaErrorCode.FORBIDDEN, FORBIDDEN_MESSAGE);
}
