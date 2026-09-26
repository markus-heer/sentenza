import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import type { SentenzaConfig } from '../config/configuration.js';
import { assertEmailAllowed } from './assert-email-allowed.js';
import type { GoogleIdentity } from './google-token.verifier.js';
import type { AuthTokenIssuer } from './token-issuer.js';

/**
 * Antwort einer erfolgreichen Anmeldung (design.md, Abschnitt "Auth-Modul";
 * Requirement 2.5): beide Tokens samt ihren Ablaufzeitpunkten in derselben
 * Antwort.
 */
export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

/**
 * Antwort einer erfolgreichen Erneuerung (design.md, Abschnitt "Auth-Modul";
 * Requirement 2.9): ausschließlich ein neues Access-Token samt
 * Ablaufzeitpunkt.
 *
 * Bewusst kein Refresh-Token darin: Eine Rotation findet nicht statt
 * (design.md, Abschnitt "Refresh-Token und Widerruf"). Requirement 2.9
 * verlangt nur ein neues Access-Token, und ein abgebrochener Aufruf im
 * MV3-Service-Worker würde bei einer Rotation die Anmeldung verlieren. Der
 * Client behält das vorgelegte Refresh-Token weiter.
 */
export interface AccessTokenResult {
  accessToken: string;
  accessTokenExpiresAt: Date;
}

/**
 * Nachricht der Ablehnung einer Erneuerung (Requirement 2.14).
 *
 * Gleichlautend für alle vier Ablehnungsgründe: Welcher davon zutrifft — nie
 * ausgestellt, abgelaufen, widerrufen, keinem Konto zuordenbar —, ist für
 * einen Angreifer nützlicher als für den berechtigten Nutzer und steht
 * deshalb nur im Protokoll (Requirement 9.3).
 */
const REFRESH_UNAUTHENTICATED_MESSAGE = 'Das Refresh-Token ist ungültig.';

/**
 * Grund einer abgelehnten Erneuerung, in der Aufzählung von Requirement 2.14.
 *
 * Erscheint ausschließlich im Protokolleintrag. Die Reihenfolge, in der
 * `refreshAccessToken` prüft, entscheidet allein darüber, welcher Grund
 * protokolliert wird — der Fehlercode nach außen ist in jedem Fall
 * `UNAUTHENTICATED`.
 */
export type RefreshTokenRejectionReason = 'not-issued' | 'revoked' | 'expired' | 'unassigned';

/**
 * Die einzige Fähigkeit, die die Anmeldung von der Prüfung des
 * Google_ID_Token braucht. `GoogleTokenVerifier` erfüllt diese Form; dass er
 * es tut, bestätigt der Type-Check an der Erzeugungsstelle.
 *
 * Als Schnittstelle geschnitten, damit der Ablauf der Anmeldung ohne
 * Netzzugriff und ohne JWKS prüfbar ist (Requirement 10.9).
 */
export interface GoogleIdentityVerifier {
  verify(idToken: string): Promise<GoogleIdentity>;
}

/**
 * Der Zugriff auf das Benutzerkonto, den die Anmeldung braucht
 * (Requirement 2.7, 2.8).
 *
 * Ein einziges `upsert` auf `googleSubject`: Es legt das Konto beim ersten Mal
 * an und schreibt bei jeder weiteren Anmeldung die E-Mail-Adresse fort. Weil
 * `googleSubject` in `schema.prisma` eindeutig ist, kann kein zweites Konto zu
 * derselben Subject-Kennung entstehen, auch nicht bei zwei gleichzeitigen
 * Anmeldungen.
 */
export interface AuthUserAccountStore {
  upsert(args: {
    where: { googleSubject: string };
    create: { googleSubject: string; email: string };
    update: { email: string };
  }): Promise<{ id: string; email: string }>;
}

/**
 * Der abgelegte Refresh-Token-Datensatz, soweit die Erneuerung ihn auswertet
 * (Requirement 2.14; design.md, Abschnitt "Refresh-Token und Widerruf").
 *
 * Die Tabelle ist die Wahrheit über die Vorlagefähigkeit: kein Datensatz zum
 * Hash ⇒ nicht von Auth_Service ausgestellt, `expiresAt` in der Vergangenheit
 * ⇒ abgelaufen, `revokedAt` gesetzt ⇒ widerrufen, fehlendes Konto ⇒ nicht
 * zuordenbar.
 *
 * `userAccount` ist hier ausdrücklich nullbar, obwohl der Fremdschlüssel in
 * `schema.prisma` nicht nullbar ist: Requirement 2.14 nennt „keinem
 * bestehenden Benutzerkonto zugeordnet" als eigenen Ablehnungsgrund, und ein
 * Typ, der das Konto als immer vorhanden behauptet, würde diesen Zweig
 * unschreibbar machen. Der nullbare Typ ist zugleich weiter als der von
 * Prisma gelieferte und bleibt deshalb von ihm erfüllt.
 */
export interface StoredRefreshToken {
  id: string;
  userAccountId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  userAccount: { id: string; email: string } | null;
}

/**
 * Der Zugriff auf die Refresh-Token-Ablage, den Anmeldung, Erneuerung und
 * Widerruf brauchen (Requirement 2.5, 2.9, 2.14).
 *
 * Gespeichert wird ausschließlich der Hash; das Token selbst verlässt den
 * Prozess nur in der Antwort an den Client (design.md, Abschnitt
 * "Refresh-Token und Widerruf"). `revokedAt` bleibt bei der Ausstellung
 * ungesetzt und ist in `schema.prisma` nullbar, deshalb steht es nicht in den
 * Daten von `create`.
 */
export interface AuthRefreshTokenStore {
  create(args: {
    data: { userAccountId: string; tokenHash: string; expiresAt: Date };
  }): Promise<{ id: string }>;

  /**
   * Sucht den Datensatz zum Hash des vorgelegten Tokens (Requirement 2.9,
   * 2.14).
   *
   * Ein einziger Zugriff über den eindeutigen Index `RefreshToken.tokenHash`,
   * der das Benutzerkonto gleich mitlädt: Die Erneuerung braucht dessen
   * E-Mail-Adresse für die erneute Freigabeprüfung, und ein zweiter Zugriff
   * könnte ein zwischenzeitlich gelöschtes Konto anders beurteilen als der
   * erste.
   */
  findUnique(args: {
    where: { tokenHash: string };
    include: { userAccount: true };
  }): Promise<StoredRefreshToken | null>;

  /**
   * Setzt `revokedAt` an einem noch nicht widerrufenen Datensatz.
   *
   * Bewusst `updateMany` statt `update`: Die Bedingung `revokedAt: null`
   * gehört in die Abfrage und nicht in eine vorgelagerte Prüfung im Service —
   * nur so entscheidet die Datenbank in einem einzigen Schritt, ob dieser
   * Aufruf der widerrufende war, und zwei gleichzeitige Widerrufe können den
   * Zeitpunkt nicht überschreiben. `update` würde bei einem unbekannten Hash
   * zusätzlich werfen, was der Widerruf nicht braucht (siehe
   * `revokeRefreshToken`).
   */
  updateMany(args: {
    where: { tokenHash: string; revokedAt: null };
    data: { revokedAt: Date };
  }): Promise<{ count: number }>;
}

/**
 * Die Teilmenge von Prisma, die Auth_Service braucht.
 *
 * Bewusst so schmal geschnitten wie `DatabasePingClient` in
 * `health/probe-database.ts`: Der Ablauf der Anmeldung ist damit ohne
 * laufende Nest-Anwendung und ohne Datenbank prüfbar. `PrismaService` erfüllt
 * diese Form; dass er es tut, bestätigt der Type-Check an der
 * Erzeugungsstelle.
 */
export interface AuthStore {
  userAccount: AuthUserAccountStore;
  refreshToken: AuthRefreshTokenStore;
}

/** Die Teilmenge der Konfiguration, die Auth_Service selbst auswertet. */
export type AuthServiceSettings = Pick<SentenzaConfig['auth'], 'allowedEmails'>;

/**
 * Auth_Service: Anmeldung mit Google, Kontoanlage und Tokenausstellung,
 * Erneuerung des Access-Tokens und Widerruf eines Refresh-Tokens
 * (Requirement 2.5, 2.6, 2.7, 2.8, 2.9, 2.14; design.md, Abschnitt
 * "Auth-Modul").
 *
 * Die Geschäftslogik liegt vollständig hier; der Resolver (Aufgabe 6.12)
 * bleibt ein dünner Umschlag. Anmeldung, Erneuerung und Widerruf verwenden
 * dieselben Mitspieler: die Freigabeprüfung, die Tokenausstellung und den
 * Zugriff auf die Refresh-Token-Ablage.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `GoogleTokenVerifier` und
 * `DatabaseHealthIndicator` wird die Klasse über eine Factory aus
 * `SentenzaConfig` erzeugt, weil ihre Mitspieler Schnittstellen sind, die
 * Nest zur Laufzeit nicht auflösen könnte. So bleibt der Ablauf zugleich ohne
 * Abhängigkeitsbaum prüfbar.
 */
export class AuthService {
  constructor(
    private readonly store: AuthStore,
    private readonly googleTokenVerifier: GoogleIdentityVerifier,
    private readonly tokenIssuer: AuthTokenIssuer,
    private readonly settings: AuthServiceSettings,
    private readonly logger: SentenzaLogger = createLogger({ component: 'auth' }),
    /**
     * Zeitquelle für den Vergleich gegen `expiresAt` und für den Zeitpunkt
     * eines Widerrufs. Konstruktorargument mit Vorgabewert wie in
     * `TokenIssuer`: Ein Test kann damit einen abgelaufenen Datensatz prüfen,
     * ohne 30 Tage zu warten oder die Systemuhr zu verstellen.
     */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Meldet ein Google-Konto an (Requirement 2.5, 2.6, 2.7, 2.8).
   *
   * Die Reihenfolge der Schritte ist fachlich bindend, nicht beliebig:
   *
   * 1. Prüfung des Google_ID_Token (Requirement 2.1–2.3, 2.13). Jeder
   *    Tokendefekt ergibt `UNAUTHENTICATED`, nicht abrufbare JWKS ergeben
   *    `UPSTREAM_UNAVAILABLE` — beides, bevor irgendetwas geschrieben wird.
   * 2. Prüfung gegen die Konto_Freigabeliste (Requirement 2.4, 2.9). Sie
   *    läuft vor dem `upsert` und vor jeder Tokenausstellung, damit eine
   *    Ablehnung mit `FORBIDDEN` weder ein Benutzerkonto anlegt noch ein
   *    Token ausstellt.
   * 3. `upsert` auf `googleSubject` (Requirement 2.7, 2.8).
   * 4. Ausstellung beider Tokens und Ablage des Refresh-Token-Hashes
   *    (Requirement 2.5, 2.6). Das Refresh-Token wird dem Client erst
   *    genannt, nachdem sein Hash gespeichert ist — scheitert die Ablage,
   *    hält der Client kein Token, das nie vorlagefähig wäre.
   */
  async signInWithGoogle(idToken: string): Promise<AuthTokens> {
    const identity = await this.googleTokenVerifier.verify(idToken);

    assertEmailAllowed(identity.email, this.settings.allowedEmails, this.logger);

    const account = await this.store.userAccount.upsert({
      where: { googleSubject: identity.subject },
      create: { googleSubject: identity.subject, email: identity.email },
      // Requirement 2.8: die gespeicherte Adresse folgt dem Token. Die
      // Google-Subject-Kennung bleibt unangetastet — sie ist der Schlüssel.
      update: { email: identity.email },
    });

    const accessToken = this.tokenIssuer.issueAccessToken(account.id);
    const refreshToken = this.tokenIssuer.issueRefreshToken();

    await this.store.refreshToken.create({
      data: {
        userAccountId: account.id,
        tokenHash: refreshToken.tokenHash,
        expiresAt: refreshToken.expiresAt,
      },
    });

    // Weder das Google-ID-Token noch die ausgestellten Tokens erscheinen im
    // Protokoll; die Redaction des Loggers entfernt sie ohnehin
    // (Requirement 9.5). Die Konto-Kennung steht dort, weil sich damit eine
    // spätere Einreichung dieser Anmeldung zuordnen lässt.
    this.logger.info('Anmeldung mit Google erfolgreich', {
      step: 'auth.signIn',
      userAccountId: account.id,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    });

    return {
      accessToken: accessToken.token,
      accessTokenExpiresAt: accessToken.expiresAt,
      refreshToken: refreshToken.token,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    };
  }

  /**
   * Stellt ohne erneute Google-Anmeldung ein neues Access-Token aus
   * (Requirement 2.9) und lehnt jedes nicht vorlagefähige Refresh-Token mit
   * `UNAUTHENTICATED` ab (Requirement 2.14).
   *
   * Der Ablauf:
   *
   * 1. Das vorgelegte Token wird auf seine gespeicherte Form abgebildet und
   *    nur noch als Hash verwendet. Das Token selbst geht in keine Abfrage
   *    und in kein Protokoll — in der Ablage steht ausschließlich der Hash
   *    (design.md, Abschnitt "Refresh-Token und Widerruf").
   * 2. Die vier Ablehnungsgründe aus Requirement 2.14 werden der Reihe nach
   *    geprüft: kein Datensatz, widerrufen, abgelaufen, keinem Konto
   *    zuordenbar. Alle vier ergeben `UNAUTHENTICATED` mit derselben
   *    Nachricht; die Reihenfolge bestimmt allein, welcher Grund im Protokoll
   *    steht. „Widerrufen" steht vor „abgelaufen", weil der Widerruf die
   *    bewusste Handlung ist und auch dann benannt sein soll, wenn das Token
   *    inzwischen ohnehin abgelaufen wäre.
   * 3. Erneute Prüfung gegen die Konto_Freigabeliste (Requirement 2.4, 2.9)
   *    mit der am Konto gespeicherten Adresse. Sie ist der Grund, warum ein
   *    nachträgliches Entfernen aus der Liste spätestens beim nächsten
   *    Erneuern wirkt, und sie läuft vor der Ausstellung, damit eine
   *    Ablehnung mit `FORBIDDEN` kein Token hinterlässt.
   * 4. Ausstellung des Access-Tokens über dieselbe Fähigkeit wie die
   *    Anmeldung, auf die interne Konto-Kennung und mit der konfigurierten
   *    Gültigkeitsdauer (Requirement 2.6).
   *
   * Das vorgelegte Refresh-Token bleibt unverändert gültig: keine Rotation,
   * kein Schreibzugriff auf die Ablage (design.md, Abschnitt "Refresh-Token
   * und Widerruf").
   */
  async refreshAccessToken(refreshToken: string): Promise<AccessTokenResult> {
    const tokenHash = this.tokenIssuer.hashRefreshToken(refreshToken);

    const stored = await this.store.refreshToken.findUnique({
      where: { tokenHash },
      include: { userAccount: true },
    });

    if (stored === null) {
      // Kein Datensatz zum Hash: nicht von Auth_Service ausgestellt — oder
      // ausgestellt und das Konto samt seiner Tokens gelöscht, was auf
      // dasselbe hinausläuft.
      throw this.rejectRefresh('not-issued');
    }

    if (stored.revokedAt !== null) {
      throw this.rejectRefresh('revoked');
    }

    // `expiresAt` ist der Zeitpunkt, zu dem die Gültigkeit endet: Ein Token
    // genau auf der Sekunde seines Ablaufs ist nicht mehr vorlagefähig.
    if (stored.expiresAt.getTime() <= this.now().getTime()) {
      throw this.rejectRefresh('expired', { refreshTokenExpiresAt: stored.expiresAt });
    }

    const account = stored.userAccount;

    if (account === null) {
      throw this.rejectRefresh('unassigned', { userAccountId: stored.userAccountId });
    }

    // Requirement 2.4, 2.9: dieselbe Prüfung wie bei der Anmeldung, hier mit
    // der am Konto gespeicherten Adresse. Sie wirft `FORBIDDEN` und
    // ausdrücklich nicht `UNAUTHENTICATED`: Das Token ist in Ordnung, das
    // Konto ist es nicht mehr.
    assertEmailAllowed(account.email, this.settings.allowedEmails, this.logger);

    const accessToken = this.tokenIssuer.issueAccessToken(account.id);

    this.logger.info('Access-Token erneuert', {
      step: 'auth.refresh',
      userAccountId: account.id,
      accessTokenExpiresAt: accessToken.expiresAt,
    });

    return { accessToken: accessToken.token, accessTokenExpiresAt: accessToken.expiresAt };
  }

  /**
   * Widerruft ein Refresh-Token, indem `revokedAt` gesetzt wird (design.md,
   * Abschnitt "Refresh-Token und Widerruf"; Entwurfsergänzung zu
   * Requirement 2.14).
   *
   * Danach ist das Token nicht mehr vorlagefähig: `refreshAccessToken` lehnt
   * es mit `UNAUTHENTICATED` und dem Grund `revoked` ab. Ein bereits
   * ausgestelltes Access-Token bleibt bis zu seinem Ablauf gültig — das ist
   * der Preis der zustandslosen Prüfung und der Grund für die kurze
   * Gültigkeitsdauer (Vorgabe 15 Minuten).
   *
   * Der Aufruf ist wiederholbar und meldet keinen Fehler, wenn nichts zu
   * widerrufen war. Zwei Gründe:
   *
   * - Der zugesagte Endzustand — dieses Token ist nicht vorlagefähig — gilt
   *   in genau diesen Fällen schon: Ein unbekannter Hash war nie ausgestellt,
   *   ein bereits gesetztes `revokedAt` bleibt stehen. Eine Abmeldung, die
   *   zweimal ausgelöst wird, hat kein Problem zu melden.
   * - Eine Ablehnung wäre ein Auskunftsmittel: Sie verriete, ob ein geratener
   *   Tokenwert überhaupt existiert. Requirement 2.14 verlangt die vier
   *   unterscheidbaren Gründe für die *Erneuerung*, nicht für den Widerruf.
   *
   * Der Grund steht als Protokolleintrag fest, damit ein ins Leere laufender
   * Widerruf nachvollziehbar bleibt.
   */
  async revokeRefreshToken(refreshToken: string): Promise<void> {
    const tokenHash = this.tokenIssuer.hashRefreshToken(refreshToken);
    const revokedAt = this.now();

    const { count } = await this.store.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt },
    });

    if (count === 0) {
      this.logger.warn('Widerruf ohne widerrufbares Refresh-Token', {
        step: 'auth.revoke',
        reason: 'not-revocable',
      });

      return;
    }

    this.logger.info('Refresh-Token widerrufen', { step: 'auth.revoke', revokedAt });
  }

  /**
   * Protokolliert den Ablehnungsgrund einer Erneuerung und liefert den Fehler,
   * den die Aufrufstelle wirft (Requirement 2.14).
   *
   * Wie in `GoogleTokenVerifier.reject`: Die Antwort an den Client trägt
   * ausschließlich `UNAUTHENTICATED` und eine für alle Gründe gleichlautende
   * Nachricht, der Grund steht im Protokoll (Requirement 9.3). Das vorgelegte
   * Token erscheint dort nicht, auch nicht als Hash — der Hash ist zwar kein
   * Geheimnis, aber der Schlüssel der Ablage, und kein Protokolleintrag
   * braucht ihn.
   */
  private rejectRefresh(
    reason: RefreshTokenRejectionReason,
    fields: Record<string, unknown> = {},
  ): SentenzaError {
    this.logger.warn('Erneuerung des Access-Tokens abgelehnt', {
      step: 'auth.refresh',
      reason,
      ...fields,
    });

    return new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, REFRESH_UNAUTHENTICATED_MESSAGE);
  }
}
