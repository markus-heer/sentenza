import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import {
  decode as decodeJwt,
  JsonWebTokenError,
  type JwtPayload,
  NotBeforeError,
  TokenExpiredError,
  verify as verifyJwt,
} from 'jsonwebtoken';
import { JwksClient, SigningKeyNotFoundError } from 'jwks-rsa';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import type { SentenzaConfig } from '../config/configuration.js';

/**
 * Zulässige Abweichung der Uhren beim Prüfen von `exp` (Requirement 2.2:
 * höchstens 60 Sekunden). Dieselbe Toleranz gilt später in `JwtStrategy` für
 * die Sentenza-Access-Tokens (Requirement 2.11).
 */
export const GOOGLE_CLOCK_TOLERANCE_SECONDS = 60;

/**
 * Lebensdauer des JWKS-Cache. Kurz genug, dass ein Schlüsselwechsel bei Google
 * binnen Minuten wirkt, lang genug, dass nicht jede Anmeldung einen Abruf
 * auslöst (design.md, Abschnitt "Prüfung des Google-ID-Tokens").
 */
export const GOOGLE_JWKS_CACHE_MAX_AGE_MS = 10 * 60 * 1_000;

/** Google veröffentlicht wenige Schlüssel gleichzeitig; mehr braucht der Cache nicht. */
const JWKS_CACHE_MAX_ENTRIES = 5;

/** Obergrenze der JWKS-Abrufe pro Minute, damit ein Tokenhagel Google nicht überrennt. */
const JWKS_REQUESTS_PER_MINUTE = 10;

/** Die einzige Signatur, mit der Google ID-Tokens ausstellt. */
const ALLOWED_ALGORITHMS = ['RS256'] as const;

/** Nachricht der Ablehnung eines defekten Tokens (Requirement 2.3). */
const UNAUTHENTICATED_MESSAGE = 'Das Google-ID-Token ist ungültig.';

/**
 * Nachricht bei nicht abrufbaren JWKS (Requirement 2.13): Sie zeigt eine
 * vorübergehend nicht mögliche Signaturprüfung an und trifft ausdrücklich keine
 * Aussage über das Token.
 */
const UPSTREAM_UNAVAILABLE_MESSAGE =
  'Die Signaturprüfung des Google-ID-Tokens ist vorübergehend nicht möglich.';

/**
 * Das Ergebnis einer erfolgreichen Prüfung: die Google-Subject-Kennung als
 * dauerhafter Schlüssel des Benutzerkontos (Requirement 2.7) und die
 * E-Mail-Adresse für den Vergleich gegen die Konto_Freigabeliste
 * (Requirement 2.4).
 *
 * Die E-Mail-Adresse wird unverändert aus dem Token übernommen; der
 * fallunabhängige Vergleich findet erst in der Freigabeprüfung statt.
 *
 * `emailVerified` ist nach einer erfolgreichen Prüfung immer `true` — ein Token
 * ohne bestätigte Adresse wird abgelehnt (Requirement 2.2). Das Feld bleibt
 * Teil der Schnittstelle, damit der Aufrufer die Zusage nicht erneut aus den
 * Requirements herleiten muss.
 */
export interface GoogleIdentity {
  subject: string;
  email: string;
  emailVerified: true;
}

/**
 * Ergebnis der Schlüsselsuche. Die Unterscheidung ist fachlich bedeutsam und
 * darum im Typ festgehalten statt in Fehlerklassen:
 *
 * - `found: false` heißt, dass die JWKS gelesen wurden und die im Token
 *   genannte Schlüsselkennung nicht enthalten war. Das ist ein Tokendefekt und
 *   ergibt `UNAUTHENTICATED` (Requirement 2.3).
 * - Ein geworfener Fehler heißt, dass die JWKS nicht gelesen werden konnten.
 *   Das ergibt `UPSTREAM_UNAVAILABLE` (Requirement 2.13).
 */
export type SigningKeyLookup = { found: true; publicKey: string } | { found: false };

/**
 * Die einzige Fähigkeit, die die Tokenprüfung von den JWKS braucht: den
 * öffentlichen Schlüssel zu einer Schlüsselkennung.
 *
 * Bewusst so schmal geschnitten wie `DatabasePingClient` in
 * `health/probe-database.ts`: Damit ist die Prüfung ohne Netzzugriff prüfbar —
 * der Test liefert den öffentlichen Schlüssel eines im Test erzeugten
 * Schlüsselpaars aus dem Speicher (Requirement 10.9).
 */
export interface GoogleSigningKeyProvider {
  getSigningKey(kid: string): Promise<SigningKeyLookup>;
}

/** Die Teilmenge der Konfiguration, die die Tokenprüfung braucht. */
export type GoogleVerificationSettings = SentenzaConfig['google'];

/**
 * Grund einer Ablehnung. Erscheint ausschließlich im Protokolleintrag, nie in
 * der Antwort an den Client: Welcher Anspruch genau verfehlt wurde, ist für
 * einen Angreifer nützlicher als für den berechtigten Nutzer
 * (Requirement 9.3).
 */
export type GoogleTokenRejectionReason =
  | 'malformed'
  | 'missing-key-id'
  | 'unknown-key'
  | 'signature'
  | 'expired'
  | 'not-yet-valid'
  | 'issuer'
  | 'audience'
  | 'incomplete-claims'
  | 'email-unverified';

/**
 * Erzeugt den JWKS-gestützten Schlüssellieferanten für den laufenden Betrieb
 * (design.md, Abschnitt "Prüfung des Google-ID-Tokens").
 *
 * `jwks-rsa` wählt den Schlüssel anhand der Schlüsselkennung, begrenzt den
 * Abruf über `timeout` und hält die Schlüssel kurzzeitig im Cache. Die
 * Unterscheidung der beiden Fehlerlagen findet hier statt: Eine nicht
 * gefundene Schlüsselkennung ist ein Ergebnis, jeder andere Fehler bleibt ein
 * Fehler und führt beim Aufrufer zu `UPSTREAM_UNAVAILABLE`.
 */
export function createJwksSigningKeyProvider(
  settings: Pick<GoogleVerificationSettings, 'jwksUri' | 'jwksTimeoutMs'>,
): GoogleSigningKeyProvider {
  const client = new JwksClient({
    jwksUri: settings.jwksUri,
    timeout: settings.jwksTimeoutMs,
    cache: true,
    cacheMaxAge: GOOGLE_JWKS_CACHE_MAX_AGE_MS,
    cacheMaxEntries: JWKS_CACHE_MAX_ENTRIES,
    rateLimit: true,
    jwksRequestsPerMinute: JWKS_REQUESTS_PER_MINUTE,
  });

  return {
    async getSigningKey(kid: string): Promise<SigningKeyLookup> {
      try {
        const key = await client.getSigningKey(kid);
        return { found: true, publicKey: key.getPublicKey() };
      } catch (error) {
        if (error instanceof SigningKeyNotFoundError) {
          return { found: false };
        }

        throw error;
      }
    },
  };
}

/** Eigener Fehlertyp, damit das Zeitlimit vom Abrufehler unterscheidbar bleibt. */
class JwksTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`JWKS-Abruf nach ${timeoutMs} ms abgebrochen`);
    this.name = 'JwksTimeoutError';
  }
}

function describeCause(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/**
 * Ordnet einen Fehler von `jsonwebtoken` einem Ablehnungsgrund zu.
 *
 * `jsonwebtoken` unterscheidet abgelaufene und noch nicht gültige Tokens über
 * eigene Fehlerklassen, alles Übrige über die Nachricht von
 * `JsonWebTokenError`. Trifft keine Zuordnung, gilt das Token als unlesbar —
 * der Fehlercode nach außen ist in jedem Fall `UNAUTHENTICATED`, die
 * Zuordnung dient allein dem Protokolleintrag.
 */
function mapVerificationError(error: unknown): GoogleTokenRejectionReason {
  if (error instanceof TokenExpiredError) {
    return 'expired';
  }

  if (error instanceof NotBeforeError) {
    return 'not-yet-valid';
  }

  if (error instanceof JsonWebTokenError) {
    if (error.message === 'invalid signature') {
      return 'signature';
    }
    if (error.message.startsWith('jwt issuer invalid')) {
      return 'issuer';
    }
    if (error.message.startsWith('jwt audience invalid')) {
      return 'audience';
    }
  }

  return 'malformed';
}

/** Nicht-leere Zeichenkette; deckt fehlende und leere Ansprüche gemeinsam ab. */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Prüfung des Google-ID-Tokens (Requirement 2.1, 2.2, 2.3, 2.13; design.md,
 * Abschnitt "Prüfung des Google-ID-Tokens").
 *
 * Ablauf: Schlüsselkennung aus dem Token-Header lesen, den zugehörigen
 * öffentlichen Schlüssel aus den JWKS holen, Signatur samt `iss`, `aud` und
 * `exp` prüfen, danach `email_verified` und die gebrauchten Ansprüche. Jeder
 * Tokendefekt ergibt `UNAUTHENTICATED` ohne Nebenwirkung; ein nicht
 * durchführbarer JWKS-Abruf ergibt `UPSTREAM_UNAVAILABLE`, weil er keine
 * Aussage über das Token trifft.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie `DatabaseHealthIndicator` wird
 * die Klasse in `auth.module.ts` über eine Factory aus `SentenzaConfig`
 * erzeugt. So bleibt sie ohne laufende Nest-Anwendung und ohne Netzzugriff
 * prüfbar, und der Schlüssellieferant ist im Test austauschbar.
 */
export class GoogleTokenVerifier {
  constructor(
    private readonly settings: GoogleVerificationSettings,
    private readonly keyProvider: GoogleSigningKeyProvider = createJwksSigningKeyProvider(settings),
    private readonly logger: SentenzaLogger = createLogger({ component: 'auth' }),
  ) {}

  /**
   * Prüft ein Google-ID-Token vollständig und gibt die darin bezeugte Identität
   * zurück. Wirft `SentenzaError` mit `UNAUTHENTICATED` bei jedem Tokendefekt
   * und mit `UPSTREAM_UNAVAILABLE`, wenn die JWKS nicht abrufbar sind.
   */
  async verify(idToken: string): Promise<GoogleIdentity> {
    const keyId = this.readKeyId(idToken);
    const publicKey = await this.resolvePublicKey(keyId);
    const payload = this.verifySignedClaims(idToken, publicKey);

    return this.readIdentity(payload);
  }

  /**
   * Liest die Schlüsselkennung aus dem Token-Header (Requirement 2.1). Ohne sie
   * ist keine Schlüsselauswahl möglich, das Token gilt damit als defekt.
   */
  private readKeyId(idToken: string): string {
    let header: unknown;

    try {
      header =
        typeof idToken === 'string' && idToken.length > 0
          ? decodeJwt(idToken, { complete: true })?.header
          : undefined;
    } catch (error) {
      throw this.reject('malformed', error);
    }

    if (header === null || typeof header !== 'object') {
      throw this.reject('malformed');
    }

    const keyId = nonEmptyString((header as Record<string, unknown>).kid);

    if (keyId === undefined) {
      throw this.reject('missing-key-id');
    }

    return keyId;
  }

  /**
   * Holt den öffentlichen Schlüssel zur Schlüsselkennung (Requirement 2.1).
   *
   * Das Zeitlimit begrenzt die Wartezeit, nicht den Abruf selbst — `jwks-rsa`
   * kennt keinen Abbruch einer laufenden Anfrage, deshalb kommt das
   * `timeout` des Clients zusätzlich zum Zug. Entscheidend für
   * Requirement 2.13 ist, dass die Ablehnung nach höchstens
   * `GOOGLE_JWKS_TIMEOUT_MS` steht, und das leistet `Promise.race`.
   */
  private async resolvePublicKey(keyId: string): Promise<string> {
    const timeoutMs = this.settings.jwksTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lookup: SigningKeyLookup;

    try {
      lookup = await Promise.race([
        this.keyProvider.getSigningKey(keyId),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new JwksTimeoutError(timeoutMs)), timeoutMs);
        }),
      ]);
    } catch (error) {
      // Requirement 2.13: Zeitüberschreitung und Netzfehler treffen keine
      // Aussage über das Token und ergeben deshalb ausdrücklich nicht
      // `UNAUTHENTICATED`.
      this.logger.warn('JWKS für die Prüfung des Google-ID-Tokens nicht abrufbar', {
        step: 'auth.google.jwks',
        reason: error instanceof JwksTimeoutError ? 'timeout' : 'unreachable',
        timeoutMs,
        cause: describeCause(error),
      });

      throw new SentenzaError(SentenzaErrorCode.UPSTREAM_UNAVAILABLE, UPSTREAM_UNAVAILABLE_MESSAGE);
    } finally {
      // Ohne dies hielte der offene Timer den Prozess bis zum Ablauf des
      // Zeitlimits wach, auch wenn die JWKS längst geantwortet haben.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }

    if (!lookup.found) {
      throw this.reject('unknown-key');
    }

    return lookup.publicKey;
  }

  /**
   * Prüft Signatur, `iss`, `aud` und `exp` (Requirement 2.1, 2.2).
   *
   * `algorithms` schließt jedes andere Verfahren aus, insbesondere `none` und
   * die symmetrischen Verfahren — ohne diese Festlegung könnte ein Token mit
   * dem öffentlichen Schlüssel als HMAC-Geheimnis signiert werden.
   */
  private verifySignedClaims(idToken: string, publicKey: string): JwtPayload {
    let payload: unknown;

    try {
      payload = verifyJwt(idToken, publicKey, {
        algorithms: [...ALLOWED_ALGORITHMS],
        issuer: this.settings.issuer,
        audience: this.settings.clientId,
        clockTolerance: GOOGLE_CLOCK_TOLERANCE_SECONDS,
      });
    } catch (error) {
      throw this.reject(mapVerificationError(error), error);
    }

    if (payload === null || typeof payload !== 'object') {
      throw this.reject('malformed');
    }

    // `jsonwebtoken` prüft `exp` nur, wenn der Anspruch vorhanden ist. Ein
    // Token ohne `exp` läge nicht "mit einer Toleranz von höchstens 60
    // Sekunden in der Zukunft" (Requirement 2.2) und ist damit ungültig.
    if (typeof (payload as JwtPayload).exp !== 'number') {
      throw this.reject('expired');
    }

    return payload as JwtPayload;
  }

  /**
   * Liest `email_verified`, `sub` und `email` (Requirement 2.2, 2.3).
   *
   * `email_verified` muss den Wahrheitswert `true` tragen; eine Zeichenkette
   * `'true'`, wie sie ältere Google-Tokens enthielten, genügt nicht.
   */
  private readIdentity(payload: JwtPayload): GoogleIdentity {
    if (payload.email_verified !== true) {
      throw this.reject('email-unverified');
    }

    const subject = nonEmptyString(payload.sub);
    const email = nonEmptyString(payload.email);

    if (subject === undefined || email === undefined) {
      throw this.reject('incomplete-claims');
    }

    return { subject, email, emailVerified: true };
  }

  /**
   * Protokolliert den Ablehnungsgrund und liefert den Fehler, den der Aufrufer
   * wirft (Requirement 2.3).
   *
   * Die Antwort an den Client trägt ausschließlich `UNAUTHENTICATED` und eine
   * gleichlautende Nachricht: Der Grund steht im Protokoll, nicht in der
   * Antwort (Requirement 9.3). Das Token selbst wird nirgends protokolliert.
   */
  private reject(reason: GoogleTokenRejectionReason, cause?: unknown): SentenzaError {
    this.logger.warn('Google-ID-Token abgelehnt', {
      step: 'auth.google.verify',
      reason,
      ...(cause === undefined ? {} : { cause: describeCause(cause) }),
    });

    return new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }
}
