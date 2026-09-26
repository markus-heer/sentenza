import { createHash, randomBytes } from 'node:crypto';

import { sign as signJwt } from 'jsonwebtoken';

import type { SentenzaConfig } from '../config/configuration.js';

/**
 * Aussteller-Kennung im Anspruch `iss` jedes Sentenza_Access_Token (design.md,
 * Abschnitt "Access-Token"). `JwtStrategy` prüft später gegen genau diesen
 * Wert (Aufgabe 6.10), deshalb steht er hier einmal und nicht zweimal.
 */
export const ACCESS_TOKEN_ISSUER = 'sentenza';

/** Die einzige Signatur, mit der Sentenza seine Access-Tokens ausstellt. */
export const ACCESS_TOKEN_ALGORITHM = 'HS256';

/** Länge des opaken Refresh-Tokens in Byte (design.md, Abschnitt "Refresh-Token und Widerruf"). */
export const REFRESH_TOKEN_BYTES = 32;

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * MILLISECONDS_PER_SECOND;

/**
 * Ansprüche eines Sentenza_Access_Token (design.md, Abschnitt
 * "Access-Token"): `sub` trägt die interne Konto-Kennung, nie die
 * Google-Subject-Kennung — nach außen sichtbar ist ausschließlich der
 * Schlüssel des eigenen Datenmodells.
 *
 * `iat` und `exp` werden ausdrücklich selbst gesetzt statt über `expiresIn`
 * von `jsonwebtoken` abgeleitet: Nur so ist der zurückgegebene
 * Ablaufzeitpunkt zeichengenau derselbe wie der Anspruch im Token
 * (Requirement 2.5, Property 26).
 */
export interface AccessTokenClaims {
  sub: string;
  iss: typeof ACCESS_TOKEN_ISSUER;
  iat: number;
  exp: number;
}

/** Ein ausgestelltes Access-Token samt seinem Ablaufzeitpunkt (Requirement 2.5, 2.6). */
export interface IssuedAccessToken {
  token: string;
  expiresAt: Date;
}

/**
 * Ein ausgestelltes Refresh-Token (Requirement 2.5).
 *
 * `token` geht an den Client und wird nirgends gespeichert; `tokenHash` ist
 * der einzige Teil, der in die Tabelle `RefreshToken` wandert (design.md,
 * Abschnitt "Refresh-Token und Widerruf").
 */
export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Die Tokenausstellung als Fähigkeit, unabhängig von ihrer Umsetzung.
 *
 * Bewusst so schmal geschnitten wie `DatabasePingClient` in
 * `health/probe-database.ts`: `AuthService` braucht drei Verfahren und kennt
 * weder `JWT_SECRET` noch die Zufallsquelle. Damit ist der Ablauf der
 * Anmeldung mit einer Attrappe prüfbar, und die Erneuerung (Aufgabe 6.8)
 * verwendet dieselbe Fähigkeit: `hashRefreshToken` bildet ein vorgelegtes
 * Token auf den gespeicherten Hash ab, `issueAccessToken` stellt das neue
 * Access-Token aus.
 */
export interface AuthTokenIssuer {
  issueAccessToken(userAccountId: string): IssuedAccessToken;
  issueRefreshToken(): IssuedRefreshToken;
  hashRefreshToken(token: string): string;
}

/** Die Teilmenge der Konfiguration, die die Tokenausstellung braucht. */
export type TokenIssuerSettings = Pick<
  SentenzaConfig['auth'],
  'jwtSecret' | 'accessTokenTtlMinutes' | 'refreshTokenTtlDays'
>;

/**
 * SHA-256 in Hex über ein Refresh-Token, passend zur Spalte
 * `RefreshToken.tokenHash` (`schema.prisma`).
 *
 * Bewusst ohne Salz und ohne Schlüsselstreckung: Das Token ist ein
 * Zufallswert aus 32 Byte, kein gewähltes Geheimnis — ein Wörterbuchangriff
 * hat daran keinen Angriffspunkt, und die Erneuerung muss den Hash in einem
 * einzigen indizierten Zugriff finden können.
 */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Opakes Zufallstoken aus 32 Byte, base64url (design.md, Abschnitt "Refresh-Token und Widerruf"). */
function createOpaqueToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/**
 * Ausstellung der Sentenza-Tokens (Requirement 2.5, 2.6; design.md,
 * Abschnitte "Access-Token" und "Refresh-Token und Widerruf").
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `GoogleTokenVerifier` und
 * `DatabaseHealthIndicator` wird die Klasse über eine Factory aus
 * `SentenzaConfig` erzeugt. Zeitquelle und Zufallsquelle sind
 * Konstruktorargumente mit Vorgabewert, damit ein Test die ausgestellten
 * Werte festlegen kann, ohne dass die Anwendung davon etwas wissen muss.
 */
export class TokenIssuer implements AuthTokenIssuer {
  constructor(
    private readonly settings: TokenIssuerSettings,
    private readonly now: () => Date = () => new Date(),
    private readonly randomToken: () => string = createOpaqueToken,
  ) {}

  /**
   * Stellt ein Access-Token für ein Benutzerkonto aus (Requirement 2.6).
   *
   * Die Gültigkeitsdauer kommt aus `ACCESS_TOKEN_TTL_MINUTES`; die Schranken
   * 5 bis 60 Minuten und der Vorgabewert 15 sind bereits in `loadConfig`
   * geprüft, hier wird der Wert nur noch verwendet.
   */
  issueAccessToken(userAccountId: string): IssuedAccessToken {
    const issuedAtSeconds = Math.floor(this.now().getTime() / MILLISECONDS_PER_SECOND);
    const expiresAtSeconds =
      issuedAtSeconds + this.settings.accessTokenTtlMinutes * SECONDS_PER_MINUTE;
    const claims: AccessTokenClaims = {
      sub: userAccountId,
      iss: ACCESS_TOKEN_ISSUER,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    };

    return {
      // `algorithm` ausdrücklich gesetzt, damit die Signatur nicht von der
      // Vorgabe der Bibliothek abhängt.
      token: signJwt(claims, this.settings.jwtSecret, { algorithm: ACCESS_TOKEN_ALGORITHM }),
      expiresAt: new Date(expiresAtSeconds * MILLISECONDS_PER_SECOND),
    };
  }

  /**
   * Stellt ein Refresh-Token aus (Requirement 2.5): ein opakes Zufallstoken
   * mit einer Gültigkeitsdauer aus `REFRESH_TOKEN_TTL_DAYS`, Vorgabe 30 Tage.
   *
   * Die Rechnung läuft über Millisekunden seit der Epoche und ist damit
   * unabhängig von Zeitzone und Sommerzeit.
   */
  issueRefreshToken(): IssuedRefreshToken {
    const token = this.randomToken();

    return {
      token,
      tokenHash: this.hashRefreshToken(token),
      expiresAt: new Date(
        this.now().getTime() + this.settings.refreshTokenTtlDays * MILLISECONDS_PER_DAY,
      ),
    };
  }

  /**
   * Bildet ein vorgelegtes Refresh-Token auf die gespeicherte Form ab.
   *
   * Die Erneuerung (Aufgabe 6.8) sucht mit diesem Hash nach dem Datensatz;
   * ein Token ohne Datensatz gilt als nicht von Auth_Service ausgestellt
   * (Requirement 2.14).
   */
  hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }
}
