import { PassportStrategy } from '@nestjs/passport';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import type { Algorithm } from 'jsonwebtoken';
import { ExtractJwt, type JwtFromRequestFunction, Strategy } from 'passport-jwt';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import type { SentenzaConfig } from '../config/configuration.js';
import type { AccessTokenStore, AuthenticatedAccount } from './authenticated-account.js';
import { ACCESS_TOKEN_ALGORITHM, ACCESS_TOKEN_ISSUER } from './token-issuer.js';

/**
 * Name, unter dem die Strategie bei Passport angemeldet ist. `GqlAuthGuard`
 * verlangt genau diesen Namen; er steht deshalb hier einmal und nicht zweimal.
 */
export const ACCESS_TOKEN_STRATEGY_NAME = 'jwt';

/**
 * Zulässige Abweichung der Uhren beim Prüfen von `exp` eines
 * Sentenza_Access_Token (Requirement 2.11: abgelehnt wird erst ein um mehr als
 * 60 Sekunden überschrittener Ablaufzeitpunkt).
 *
 * Eigene Konstante neben `GOOGLE_CLOCK_TOLERANCE_SECONDS`, obwohl beide
 * denselben Wert tragen: Dort entstammt die Toleranz Requirement 2.2 und gilt
 * für ein fremdes Token, hier entstammt sie Requirement 2.11 und gilt für ein
 * eigenes. Zwei Requirements, zwei Konstanten — eine gemeinsame wäre eine
 * Behauptung über die Zukunft, die keines der beiden deckt.
 */
export const ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS = 60;

/** Nachricht der Ablehnung eines nicht zuordenbaren Tokens (Requirement 2.11). */
const UNAUTHENTICATED_MESSAGE = 'Das Access-Token ist ungültig.';

/** Die Teilmenge der Konfiguration, die die Prüfung des Access-Tokens braucht. */
export type JwtStrategySettings = Pick<SentenzaConfig['auth'], 'jwtSecret'>;

/**
 * Grund einer Ablehnung durch die Strategie. Erscheint ausschließlich im
 * Protokolleintrag, nie in der Antwort an den Client (Requirement 9.3):
 *
 * - `issuer` — der Anspruch `iss` trägt nicht `sentenza`.
 * - `incomplete-claims` — `sub` fehlt oder ist leer.
 * - `unknown-account` — `sub` bezeichnet kein bestehendes Benutzerkonto.
 */
export type AccessTokenRejectionReason = 'issuer' | 'incomplete-claims' | 'unknown-account';

/**
 * Die Prüfoptionen für ein Sentenza_Access_Token (Requirement 2.10, 2.11;
 * design.md, Abschnitt "Access-Token").
 *
 * Eigener Typ statt `StrategyOptions` von `passport-jwt`: Dort ist jedes Feld
 * wahlfrei, hier ist jedes Feld verlangt. Damit kann keines der fünf beim
 * Umbauen stillschweigend wegfallen — und ein Test kann die Optionen lesen und
 * prüfen, ohne Passport in Gang zu setzen. Die Form bleibt zu
 * `StrategyOptionsWithoutRequest` passend; dass sie es tut, bestätigt der
 * Type-Check am `super`-Aufruf in `JwtStrategy`.
 */
export interface AccessTokenStrategyOptions {
  jwtFromRequest: JwtFromRequestFunction;
  secretOrKey: string;
  algorithms: Algorithm[];
  issuer: string;
  jsonWebTokenOptions: { clockTolerance: number };
}

/**
 * Baut die Prüfoptionen aus der Konfiguration (Requirement 2.10, 2.11).
 *
 * Jede einzelne Festlegung trägt eine Zusage:
 *
 * - `jwtFromRequest` liest ausschließlich `Authorization: Bearer …`. Ein Token
 *   aus einem Abfrageparameter oder aus dem Nachrichtenkörper landet nicht in
 *   Protokollen und Zwischenspeichern, weil es dort nicht gelesen wird.
 * - `secretOrKey` ist `JWT_SECRET`, das Geheimnis, mit dem `TokenIssuer`
 *   signiert.
 * - `algorithms` lässt allein HS256 zu. Ohne diese Festlegung könnte ein
 *   Angreifer das Verfahren im Token-Header wählen, insbesondere `none`.
 * - `issuer` verlangt `sentenza` und schließt damit ein anderswo ausgestelltes
 *   Token aus, selbst wenn es dasselbe Geheimnis verwendete.
 * - `clockTolerance` erlaubt die von Requirement 2.11 zugestandenen 60
 *   Sekunden. `ignoreExpiration` bleibt ungesetzt und damit falsch: `exp` wird
 *   geprüft.
 */
export function accessTokenStrategyOptions(
  settings: JwtStrategySettings,
): AccessTokenStrategyOptions {
  return {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: settings.jwtSecret,
    algorithms: [ACCESS_TOKEN_ALGORITHM],
    issuer: ACCESS_TOKEN_ISSUER,
    jsonWebTokenOptions: { clockTolerance: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS },
  };
}

/** Nicht-leere Zeichenkette; deckt fehlende und leere Ansprüche gemeinsam ab. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Prüfung des Sentenza_Access_Token (Requirement 2.10, 2.11; design.md,
 * Abschnitte "Access-Token" und "Guard und Request-Kontext").
 *
 * Die Arbeit ist geteilt: Signatur, `iss`, `exp` und das zugelassene Verfahren
 * prüft `passport-jwt` anhand von `accessTokenStrategyOptions`, bevor `validate`
 * überhaupt aufgerufen wird. `validate` beantwortet die verbleibende Frage aus
 * Requirement 2.10 — ob das Token einem bestehenden Benutzerkonto zuzuordnen
 * ist — und liefert das Konto, das der Guard für die Dauer der Operation
 * bereitstellt.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `GoogleTokenVerifier` und
 * `TokenIssuer` wird die Klasse in `auth.module.ts` über eine Factory aus
 * `SentenzaConfig` erzeugt. Dass Nest sie als Provider anlegt, genügt für die
 * Anmeldung bei Passport — das erledigt der Konstruktor der Mixin-Basis.
 */
export class JwtStrategy extends PassportStrategy(Strategy, ACCESS_TOKEN_STRATEGY_NAME) {
  constructor(
    private readonly store: AccessTokenStore,
    settings: JwtStrategySettings,
    private readonly logger: SentenzaLogger = createLogger({ component: 'auth' }),
  ) {
    super(accessTokenStrategyOptions(settings));
  }

  /**
   * Ordnet ein bereits signaturgeprüftes Token einem Benutzerkonto zu
   * (Requirement 2.10) und lehnt es andernfalls mit `UNAUTHENTICATED` ab
   * (Requirement 2.11).
   *
   * Der Anspruch `iss` wird hier ein zweites Mal geprüft, obwohl
   * `accessTokenStrategyOptions` ihn bereits verlangt. Das ist kein Versehen:
   * Die Zuordnung eines Kontos ist der einzige Schritt, der aus dem Token
   * heraus in den eigenen Datenbestand greift, und sie soll nicht davon
   * abhängen, dass eine Option an anderer Stelle richtig gesetzt ist.
   *
   * Der Parameter ist `unknown` und nicht ein Anspruchstyp: Was hier ankommt,
   * ist geparster Fremdinhalt. Erst die Prüfungen in dieser Methode machen
   * daraus Werte, auf die sich eine Abfrage stützen darf.
   */
  async validate(payload: unknown): Promise<AuthenticatedAccount> {
    if (payload === null || typeof payload !== 'object') {
      throw this.reject('incomplete-claims');
    }

    const claims = payload as Record<string, unknown>;

    if (claims.iss !== ACCESS_TOKEN_ISSUER) {
      throw this.reject('issuer');
    }

    const userAccountId = nonEmptyString(claims.sub);

    if (userAccountId === undefined) {
      throw this.reject('incomplete-claims');
    }

    const account = await this.store.userAccount.findUnique({ where: { id: userAccountId } });

    if (account === null) {
      // Requirement 2.11: Ein Token, dessen `sub` kein bestehendes Konto
      // bezeichnet, ist ungültig — etwa nach dem Löschen des Kontos, während
      // das Token noch nicht abgelaufen war.
      throw this.reject('unknown-account', { userAccountId });
    }

    return { id: account.id, email: account.email };
  }

  /**
   * Protokolliert den Ablehnungsgrund und liefert den Fehler, den `validate`
   * wirft (Requirement 2.11).
   *
   * Wie in `GoogleTokenVerifier.reject` und `AuthService.rejectRefresh`: Die
   * Antwort an den Client trägt ausschließlich `UNAUTHENTICATED` und eine für
   * alle Gründe gleichlautende Nachricht, der Grund steht im Protokoll
   * (Requirement 9.3). Das Token selbst erscheint dort nicht.
   */
  private reject(
    reason: AccessTokenRejectionReason,
    fields: Record<string, unknown> = {},
  ): SentenzaError {
    this.logger.warn('Access-Token abgelehnt', {
      step: 'auth.accessToken.verify',
      reason,
      ...fields,
    });

    return new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }
}
