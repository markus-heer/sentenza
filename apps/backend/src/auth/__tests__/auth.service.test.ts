import { createHash } from 'node:crypto';

import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import * as fc from 'fast-check';
import { decode as decodeJwt, verify as verifyJwt } from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDatabase } from '../../../test/reset-database.js';
import { createTestDatabaseClient } from '../../../test/test-database-client.js';
import { createLogger, type SentenzaLogger } from '../../common/logger.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { PrismaClient } from '../../prisma/prisma.types.js';
import {
  AuthService,
  type AuthServiceSettings,
  type AuthStore,
  type GoogleIdentityVerifier,
  type RefreshTokenRejectionReason,
  type StoredRefreshToken,
} from '../auth.service.js';
import type { GoogleIdentity } from '../google-token.verifier.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_ISSUER,
  type AuthTokenIssuer,
  type IssuedAccessToken,
  type IssuedRefreshToken,
  REFRESH_TOKEN_BYTES,
  TokenIssuer,
  type TokenIssuerSettings,
} from '../token-issuer.js';

/**
 * Anmeldung mit Google: Kontoanlage und Tokenausstellung (Aufgabe 6.5;
 * Requirement 2.5, 2.6, 2.7, 2.8).
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Klasse
 * wird von Hand instanziiert, Prisma und die Tokenausstellung sind Attrappen,
 * die ihre Aufrufe mitschreiben. Geprüft wird damit genau das, was in dieser
 * Aufgabe liegt — die Reihenfolge der Schritte, die Argumente des `upsert`,
 * die Ablage ausschließlich des Hashes und die Zusage, dass eine Ablehnung
 * weder ein Konto anlegt noch ein Token ausstellt.
 *
 * Die Gültigkeitsdauern prüft der eigenschaftsbasierte Test zu Property 26
 * weiter unten in dieser Datei, dort mit der echten Tokenausstellung statt
 * einer Attrappe. Die Eindeutigkeit des Kontos je Google-Subject-Kennung
 * prüft der eigenschaftsbasierte Test zu Property 27 am Ende dieser Datei,
 * dort gegen die echte Testdatenbank.
 */

const IDENTITY: GoogleIdentity = {
  subject: 'google-subject-1',
  email: 'nutzer@example.com',
  emailVerified: true,
};

const SETTINGS: AuthServiceSettings = { allowedEmails: ['nutzer@example.com'] };

const ISSUED_ACCESS_TOKEN: IssuedAccessToken = {
  token: 'access-token-attrappe',
  expiresAt: new Date('2026-03-01T10:35:30.000Z'),
};

const ISSUED_REFRESH_TOKEN: IssuedRefreshToken = {
  token: 'refresh-token-attrappe',
  tokenHash: 'hash-des-refresh-tokens',
  expiresAt: new Date('2026-03-31T10:20:30.000Z'),
};

/** Ein mitgeschriebener `upsert`-Aufruf, wie ihn `AuthUserAccountStore` entgegennimmt. */
type UpsertCall = Parameters<AuthStore['userAccount']['upsert']>[0];
/** Ein mitgeschriebener `create`-Aufruf der Refresh-Token-Ablage. */
type CreateCall = Parameters<AuthStore['refreshToken']['create']>[0];
/** Ein mitgeschriebener Lesezugriff der Erneuerung. */
type FindUniqueCall = Parameters<AuthStore['refreshToken']['findUnique']>[0];
/** Ein mitgeschriebener Schreibzugriff des Widerrufs. */
type UpdateManyCall = Parameters<AuthStore['refreshToken']['updateMany']>[0];

interface StoreDouble extends AuthStore {
  readonly upsertCalls: UpsertCall[];
  readonly createCalls: CreateCall[];
  readonly findUniqueCalls: FindUniqueCall[];
  readonly updateManyCalls: UpdateManyCall[];
}

interface StoreDoubleOptions {
  accountId?: string;
  createFails?: Error;
  /** Der Datensatz, den die Erneuerung zum gesuchten Hash findet; `null` heißt: keiner. */
  storedRefreshToken?: StoredRefreshToken | null;
  /** Anzahl der Datensätze, die der Widerruf antrifft; 0 heißt: nichts zu widerrufen. */
  revocableCount?: number;
}

/**
 * Prisma-Attrappe. `upsert` verhält sich wie die Datenbank es täte: Es gibt die
 * Kennung des Kontos und die fortgeschriebene Adresse zurück. `findUnique`
 * antwortet ausschließlich mit dem vorgegebenen Datensatz und prüft den Hash
 * nicht selbst — welcher Hash gesucht wurde, hält der Test an
 * `findUniqueCalls` fest.
 */
function storeDouble(options: StoreDoubleOptions = {}): StoreDouble {
  const upsertCalls: UpsertCall[] = [];
  const createCalls: CreateCall[] = [];
  const findUniqueCalls: FindUniqueCall[] = [];
  const updateManyCalls: UpdateManyCall[] = [];
  const accountId = options.accountId ?? 'konto-1';

  return {
    upsertCalls,
    createCalls,
    findUniqueCalls,
    updateManyCalls,
    userAccount: {
      upsert(args) {
        upsertCalls.push(args);
        return Promise.resolve({ id: accountId, email: args.update.email });
      },
    },
    refreshToken: {
      create(args) {
        createCalls.push(args);
        if (options.createFails) {
          return Promise.reject(options.createFails);
        }
        return Promise.resolve({ id: 'refresh-token-1' });
      },
      findUnique(args) {
        findUniqueCalls.push(args);
        return Promise.resolve(options.storedRefreshToken ?? null);
      },
      updateMany(args) {
        updateManyCalls.push(args);
        return Promise.resolve({ count: options.revocableCount ?? 1 });
      },
    },
  };
}

interface VerifierDouble extends GoogleIdentityVerifier {
  readonly seenTokens: string[];
}

function verifierDouble(result: GoogleIdentity | Error): VerifierDouble {
  const seenTokens: string[] = [];

  return {
    seenTokens,
    verify(idToken) {
      seenTokens.push(idToken);
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    },
  };
}

interface IssuerDouble extends AuthTokenIssuer {
  readonly accessTokenSubjects: string[];
  readonly issuedRefreshTokens: number;
  readonly hashedTokens: string[];
}

/**
 * Abbildung eines vorgelegten Refresh-Tokens auf seine gespeicherte Form.
 *
 * Bewusst ein echter SHA-256 statt eines Präfixes vor dem Token: Nur mit einer
 * Abbildung, die das Token nicht wiedergibt, sind die Zusagen „in der Abfrage
 * steht nur der Hash" und „im Protokoll steht das Token nicht" überhaupt
 * prüfbar. Dass die Anwendung dieselbe Abbildung verwendet, prüft
 * `token-issuer.test.ts`; hier zählt allein, dass `AuthService` das Token
 * niemals unverändert weitergibt.
 */
function hashLikeTokenIssuer(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function issuerDouble(): IssuerDouble {
  const accessTokenSubjects: string[] = [];
  const hashedTokens: string[] = [];
  let issuedRefreshTokens = 0;

  return {
    accessTokenSubjects,
    hashedTokens,
    get issuedRefreshTokens() {
      return issuedRefreshTokens;
    },
    issueAccessToken(userAccountId) {
      accessTokenSubjects.push(userAccountId);
      return ISSUED_ACCESS_TOKEN;
    },
    issueRefreshToken() {
      issuedRefreshTokens += 1;
      return ISSUED_REFRESH_TOKEN;
    },
    hashRefreshToken(token) {
      hashedTokens.push(token);
      return hashLikeTokenIssuer(token);
    },
  };
}

function loggerCollecting(): { logger: SentenzaLogger; lines: string[] } {
  const lines: string[] = [];

  return {
    logger: createLogger({ component: 'auth', level: 'debug', sink: (line) => lines.push(line) }),
    lines,
  };
}

function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Harness {
  service: AuthService;
  store: StoreDouble;
  verifier: VerifierDouble;
  issuer: IssuerDouble;
  lines: string[];
}

function harness(
  options: StoreDoubleOptions & {
    identity?: GoogleIdentity | Error;
    settings?: AuthServiceSettings;
    /** Festgelegte Zeitquelle für Ablaufvergleich und Widerrufszeitpunkt. */
    now?: Date;
  } = {},
): Harness {
  const store = storeDouble(options);
  const verifier = verifierDouble(options.identity ?? IDENTITY);
  const issuer = issuerDouble();
  const { logger, lines } = loggerCollecting();
  const now = options.now;

  return {
    service: new AuthService(
      store,
      verifier,
      issuer,
      options.settings ?? SETTINGS,
      logger,
      now === undefined ? undefined : () => now,
    ),
    store,
    verifier,
    issuer,
    lines,
  };
}

/** Fängt die Ablehnung und gibt sie zur weiteren Prüfung zurück. */
async function rejectionOf(
  service: AuthService,
  idToken = 'ein-google-id-token',
): Promise<unknown> {
  try {
    await service.signInWithGoogle(idToken);
  } catch (error) {
    return error;
  }

  throw new Error('Die Anmeldung wurde erwartungswidrig nicht abgelehnt.');
}

describe('AuthService.signInWithGoogle', () => {
  it('gibt beide Tokens samt Ablaufzeitpunkten zurück', async () => {
    const { service } = harness();

    // Requirement 2.5: beide Tokens und beide Ablaufzeitpunkte in derselben
    // Antwort.
    await expect(service.signInWithGoogle('ein-google-id-token')).resolves.toEqual({
      accessToken: ISSUED_ACCESS_TOKEN.token,
      accessTokenExpiresAt: ISSUED_ACCESS_TOKEN.expiresAt,
      refreshToken: ISSUED_REFRESH_TOKEN.token,
      refreshTokenExpiresAt: ISSUED_REFRESH_TOKEN.expiresAt,
    });
  });

  it('prüft das übergebene Google-ID-Token unverändert', async () => {
    const { service, verifier } = harness();

    await service.signInWithGoogle('ein-google-id-token');

    expect(verifier.seenTokens).toEqual(['ein-google-id-token']);
  });

  it('legt das Benutzerkonto über ein upsert auf googleSubject an', async () => {
    const { service, store } = harness();

    await service.signInWithGoogle('ein-google-id-token');

    // Requirement 2.7, 2.8: ein einziger Schreibzugriff, Schlüssel ist die
    // Google-Subject-Kennung, die Adresse wird fortgeschrieben.
    expect(store.upsertCalls).toEqual([
      {
        where: { googleSubject: IDENTITY.subject },
        create: { googleSubject: IDENTITY.subject, email: IDENTITY.email },
        update: { email: IDENTITY.email },
      },
    ]);
  });

  it('schreibt die E-Mail-Adresse eines bestehenden Kontos fort, ohne den Schlüssel zu ändern', async () => {
    const { service, store } = harness({
      identity: { ...IDENTITY, email: 'Zweitadresse@Example.COM' },
      settings: { allowedEmails: ['zweitadresse@example.com'] },
    });

    await service.signInWithGoogle('ein-google-id-token');

    // Requirement 2.8: die Adresse folgt dem Token, zeichengleich wie darin;
    // `googleSubject` steht ausschließlich in `where` und `create`.
    expect(store.upsertCalls[0]?.update).toEqual({ email: 'Zweitadresse@Example.COM' });
    expect(store.upsertCalls[0]?.where).toEqual({ googleSubject: IDENTITY.subject });
  });

  it('stellt das Access-Token auf die interne Konto-Kennung aus, nicht auf die Google-Subject-Kennung', async () => {
    const { service, issuer } = harness({ accountId: 'konto-42' });

    await service.signInWithGoogle('ein-google-id-token');

    expect(issuer.accessTokenSubjects).toEqual(['konto-42']);
  });

  it('legt vom Refresh-Token ausschließlich den Hash ab', async () => {
    const { service, store } = harness({ accountId: 'konto-42' });

    const tokens = await service.signInWithGoogle('ein-google-id-token');

    // design.md, "Refresh-Token und Widerruf": in der Tabelle steht nur der
    // Hash, nie das Token selbst.
    expect(store.createCalls).toEqual([
      {
        data: {
          userAccountId: 'konto-42',
          tokenHash: ISSUED_REFRESH_TOKEN.tokenHash,
          expiresAt: ISSUED_REFRESH_TOKEN.expiresAt,
        },
      },
    ]);
    expect(JSON.stringify(store.createCalls)).not.toContain(tokens.refreshToken);
  });

  it('protokolliert die Anmeldung ohne Token und ohne E-Mail-Adresse im Klartext', async () => {
    const { service, lines } = harness({ accountId: 'konto-42' });

    await service.signInWithGoogle('ein-google-id-token');

    const [entry, ...weitere] = logEntries(lines);
    expect(weitere).toEqual([]);
    expect(entry?.step).toBe('auth.signIn');
    expect(entry?.userAccountId).toBe('konto-42');
    // Requirement 9.5: kein Geheimnis in einem Protokolleintrag. Die Redaction
    // des Loggers entfernt `accessToken` und `refreshToken`; der Test hält
    // fest, dass auch kein anderes Feld sie einschmuggelt.
    const serialized = lines.join('\n');
    expect(serialized).not.toContain('ein-google-id-token');
    expect(serialized).not.toContain(ISSUED_ACCESS_TOKEN.token);
    expect(serialized).not.toContain(ISSUED_REFRESH_TOKEN.token);
  });

  describe('lehnt ab, ohne ein Konto anzulegen oder ein Token auszustellen', () => {
    it('wenn die Prüfung des Google-ID-Tokens fehlschlägt', async () => {
      const abgelehnt = new SentenzaError(
        SentenzaErrorCode.UNAUTHENTICATED,
        'Das Google-ID-Token ist ungültig.',
      );
      const { service, store, issuer } = harness({ identity: abgelehnt });

      // Requirement 2.3: der Fehlercode der Prüfung bleibt unverändert.
      await expect(rejectionOf(service)).resolves.toBe(abgelehnt);
      expect(store.upsertCalls).toEqual([]);
      expect(store.createCalls).toEqual([]);
      expect(issuer.accessTokenSubjects).toEqual([]);
      expect(issuer.issuedRefreshTokens).toBe(0);
    });

    it('wenn die JWKS nicht abrufbar sind', async () => {
      const gestoert = new SentenzaError(
        SentenzaErrorCode.UPSTREAM_UNAVAILABLE,
        'Die Signaturprüfung des Google-ID-Tokens ist vorübergehend nicht möglich.',
      );
      const { service, store, issuer } = harness({ identity: gestoert });

      // Requirement 2.13: ausdrücklich `UPSTREAM_UNAVAILABLE`, nicht
      // `UNAUTHENTICATED` — die Störung trifft keine Aussage über das Token.
      const error = await rejectionOf(service);
      expect((error as SentenzaError).code).toBe(SentenzaErrorCode.UPSTREAM_UNAVAILABLE);
      expect(store.upsertCalls).toEqual([]);
      expect(issuer.issuedRefreshTokens).toBe(0);
    });

    it('wenn die E-Mail-Adresse nicht in der Konto_Freigabeliste steht', async () => {
      const { service, store, issuer, lines } = harness({
        settings: { allowedEmails: ['jemand.anders@example.com'] },
      });

      // Requirement 2.4: `FORBIDDEN`, und die Freigabeprüfung läuft vor dem
      // `upsert` und vor jeder Tokenausstellung.
      const error = await rejectionOf(service);
      expect(error).toBeInstanceOf(SentenzaError);
      expect((error as SentenzaError).code).toBe(SentenzaErrorCode.FORBIDDEN);
      expect(store.upsertCalls).toEqual([]);
      expect(store.createCalls).toEqual([]);
      expect(issuer.accessTokenSubjects).toEqual([]);
      expect(issuer.issuedRefreshTokens).toBe(0);
      expect(logEntries(lines)[0]?.step).toBe('auth.allowlist');
    });
  });

  it('nennt dem Client kein Refresh-Token, dessen Hash nicht abgelegt werden konnte', async () => {
    const { service, issuer } = harness({ createFails: new Error('Verbindung verloren') });

    // Ohne Datensatz wäre das Token nicht vorlagefähig (Requirement 2.14); die
    // Anmeldung schlägt deshalb fehl statt ein unbrauchbares Token zu liefern.
    await expect(rejectionOf(service)).resolves.toBeInstanceOf(Error);
    expect(issuer.issuedRefreshTokens).toBe(1);
  });
});

/**
 * Erneuerung des Access-Tokens und Widerruf eines Refresh-Tokens (Aufgabe 6.8;
 * Requirement 2.9, 2.14).
 *
 * Dieselbe Prüfweise wie oben: keine Nest-DI, keine Datenbank, kein
 * Netzzugriff. Die Ablage ist eine Attrappe, die den gefundenen Datensatz
 * vorgibt und ihre Zugriffe mitschreibt; die Zeitquelle ist festgelegt, damit
 * ein abgelaufener Datensatz ohne Warten prüfbar ist.
 *
 * Der eigenschaftsbasierte Test zu Property 28 (Aufgabe 6.9) durchmisst die
 * vier Ablehnungsgründe aus Requirement 2.14 anschließend über erzeugte
 * Eingaben; die Tests hier halten je Grund einen Beispielfall fest und dazu
 * die Zusagen, die keine Eigenschaft ausspricht: der Zugriff ausschließlich
 * über den Hash, die ausbleibende Rotation und die Form des
 * Protokolleintrags.
 */

/** Ein vorlagefähiges Refresh-Token, wie es in der Ablage steht. */
const STORED_REFRESH_TOKEN: StoredRefreshToken = {
  id: 'refresh-token-1',
  userAccountId: 'konto-42',
  expiresAt: new Date('2026-03-31T10:20:30.000Z'),
  revokedAt: null,
  userAccount: { id: 'konto-42', email: 'nutzer@example.com' },
};

/** Zeitpunkt der Erneuerung: deutlich vor dem Ablauf des Datensatzes. */
const REFRESH_NOW = new Date('2026-03-10T08:00:00.000Z');

/** Das Token, das der Client vorlegt; sein Hash ist der Schlüssel der Ablage. */
const PRESENTED_REFRESH_TOKEN = 'ein-vorgelegtes-refresh-token';

/** Fängt die Ablehnung einer Erneuerung und gibt sie zur weiteren Prüfung zurück. */
async function refreshRejectionOf(service: AuthService): Promise<unknown> {
  try {
    await service.refreshAccessToken(PRESENTED_REFRESH_TOKEN);
  } catch (error) {
    return error;
  }

  throw new Error('Die Erneuerung wurde erwartungswidrig nicht abgelehnt.');
}

describe('AuthService.refreshAccessToken', () => {
  it('stellt ein neues Access-Token samt Ablaufzeitpunkt aus', async () => {
    const { service, issuer } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
    });

    // Requirement 2.9: ein neues Access-Token mit seinem Ablaufzeitpunkt, ohne
    // erneute Google-Anmeldung — die Prüfung des Google_ID_Token wird nicht
    // aufgerufen.
    await expect(service.refreshAccessToken(PRESENTED_REFRESH_TOKEN)).resolves.toEqual({
      accessToken: ISSUED_ACCESS_TOKEN.token,
      accessTokenExpiresAt: ISSUED_ACCESS_TOKEN.expiresAt,
    });
    // Requirement 2.12: die Kennung kommt aus dem Datensatz, nicht aus einer
    // Eingabe.
    expect(issuer.accessTokenSubjects).toEqual(['konto-42']);
  });

  it('meldet die Erneuerung nicht als Anmeldung an Google', async () => {
    const { service, verifier } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
    });

    await service.refreshAccessToken(PRESENTED_REFRESH_TOKEN);

    expect(verifier.seenTokens).toEqual([]);
  });

  it('sucht den Datensatz ausschließlich über den Hash des vorgelegten Tokens', async () => {
    const { service, store, issuer } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
    });

    await service.refreshAccessToken(PRESENTED_REFRESH_TOKEN);

    // design.md, "Refresh-Token und Widerruf": in der Ablage steht nur der
    // Hash, also kann auch nur mit ihm gesucht werden.
    expect(issuer.hashedTokens).toEqual([PRESENTED_REFRESH_TOKEN]);
    expect(store.findUniqueCalls).toEqual([
      {
        where: { tokenHash: hashLikeTokenIssuer(PRESENTED_REFRESH_TOKEN) },
        include: { userAccount: true },
      },
    ]);
    expect(JSON.stringify(store.findUniqueCalls)).not.toContain(PRESENTED_REFRESH_TOKEN);
  });

  it('rotiert das Refresh-Token nicht', async () => {
    const { service, store, issuer } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
    });

    await service.refreshAccessToken(PRESENTED_REFRESH_TOKEN);

    // design.md, "Refresh-Token und Widerruf": kein neues Refresh-Token und
    // kein Schreibzugriff auf die Ablage — das vorgelegte Token bleibt gültig.
    expect(issuer.issuedRefreshTokens).toBe(0);
    expect(store.createCalls).toEqual([]);
    expect(store.updateManyCalls).toEqual([]);
  });

  it('protokolliert die Erneuerung ohne Token und ohne Hash', async () => {
    const { service, lines } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
    });

    await service.refreshAccessToken(PRESENTED_REFRESH_TOKEN);

    const [entry, ...weitere] = logEntries(lines);
    expect(weitere).toEqual([]);
    expect(entry?.step).toBe('auth.refresh');
    expect(entry?.userAccountId).toBe('konto-42');
    // Requirement 9.5: kein Geheimnis im Protokoll. Der Hash ist zwar keines,
    // aber der Schlüssel der Ablage und hat dort ebenso nichts zu suchen.
    const serialized = lines.join('\n');
    expect(serialized).not.toContain(PRESENTED_REFRESH_TOKEN);
    expect(serialized).not.toContain(hashLikeTokenIssuer(PRESENTED_REFRESH_TOKEN));
    expect(serialized).not.toContain(ISSUED_ACCESS_TOKEN.token);
  });

  describe('lehnt mit UNAUTHENTICATED ab, ohne ein Access-Token auszustellen', () => {
    /** Prüft die gemeinsame Zusage aller vier Ablehnungsgründe. */
    async function expectRejected(
      options: Parameters<typeof harness>[0],
      expectedReason: string,
    ): Promise<void> {
      const { service, issuer, store, lines } = harness(options);

      const error = await refreshRejectionOf(service);

      expect(error).toBeInstanceOf(SentenzaError);
      expect((error as SentenzaError).code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
      // Requirement 2.14: kein neues Access-Token, und kein Schreibzugriff.
      expect(issuer.accessTokenSubjects).toEqual([]);
      expect(store.createCalls).toEqual([]);
      expect(store.updateManyCalls).toEqual([]);
      // Der Grund steht im Protokoll, nicht in der Antwort (Requirement 9.3).
      const [entry] = logEntries(lines);
      expect(entry?.step).toBe('auth.refresh');
      expect(entry?.reason).toBe(expectedReason);
      expect((error as SentenzaError).message).toBe('Das Refresh-Token ist ungültig.');
    }

    it('wenn zum Hash kein Datensatz vorliegt', async () => {
      // Requirement 2.14: nicht von Auth_Service ausgestellt.
      await expectRejected({ storedRefreshToken: null, now: REFRESH_NOW }, 'not-issued');
    });

    it('wenn das Token widerrufen wurde', async () => {
      await expectRejected(
        {
          storedRefreshToken: {
            ...STORED_REFRESH_TOKEN,
            revokedAt: new Date('2026-03-09T12:00:00.000Z'),
          },
          now: REFRESH_NOW,
        },
        'revoked',
      );
    });

    it('wenn das Token abgelaufen ist', async () => {
      await expectRejected(
        {
          storedRefreshToken: {
            ...STORED_REFRESH_TOKEN,
            expiresAt: new Date(REFRESH_NOW.getTime() - 1),
          },
          now: REFRESH_NOW,
        },
        'expired',
      );
    });

    it('wenn der Ablaufzeitpunkt genau erreicht ist', async () => {
      // Grenzfall: `expiresAt` ist der Zeitpunkt, zu dem die Gültigkeit endet.
      await expectRejected(
        {
          storedRefreshToken: { ...STORED_REFRESH_TOKEN, expiresAt: REFRESH_NOW },
          now: REFRESH_NOW,
        },
        'expired',
      );
    });

    it('wenn der Datensatz keinem bestehenden Benutzerkonto zuordenbar ist', async () => {
      await expectRejected(
        {
          storedRefreshToken: { ...STORED_REFRESH_TOKEN, userAccount: null },
          now: REFRESH_NOW,
        },
        'unassigned',
      );
    });

    it('benennt den Widerruf auch dann, wenn das Token zusätzlich abgelaufen ist', async () => {
      // Die Reihenfolge der Prüfungen entscheidet allein über den
      // protokollierten Grund; der Widerruf ist die bewusste Handlung.
      await expectRejected(
        {
          storedRefreshToken: {
            ...STORED_REFRESH_TOKEN,
            expiresAt: new Date(REFRESH_NOW.getTime() - 1),
            revokedAt: new Date('2026-03-09T12:00:00.000Z'),
          },
          now: REFRESH_NOW,
        },
        'revoked',
      );
    });
  });

  it('lehnt mit FORBIDDEN ab, wenn die Adresse des Kontos nicht mehr in der Konto_Freigabeliste steht', async () => {
    const { service, issuer, lines } = harness({
      storedRefreshToken: STORED_REFRESH_TOKEN,
      now: REFRESH_NOW,
      settings: { allowedEmails: ['jemand.anders@example.com'] },
    });

    // Requirement 2.4, 2.9: die Freigabeprüfung läuft bei jeder Erneuerung
    // erneut, damit ein nachträgliches Entfernen aus der Liste spätestens beim
    // nächsten Erneuern wirkt. Ausdrücklich `FORBIDDEN`, nicht
    // `UNAUTHENTICATED`: Das Token ist in Ordnung, das Konto ist es nicht mehr.
    const error = await refreshRejectionOf(service);
    expect(error).toBeInstanceOf(SentenzaError);
    expect((error as SentenzaError).code).toBe(SentenzaErrorCode.FORBIDDEN);
    expect(issuer.accessTokenSubjects).toEqual([]);
    expect(logEntries(lines)[0]?.step).toBe('auth.allowlist');
  });
});

describe('AuthService.revokeRefreshToken', () => {
  it('setzt revokedAt am noch nicht widerrufenen Datensatz zum Hash des Tokens', async () => {
    const { service, store } = harness({ now: REFRESH_NOW, revocableCount: 1 });

    await expect(service.revokeRefreshToken(PRESENTED_REFRESH_TOKEN)).resolves.toBeUndefined();

    // Die Bedingung `revokedAt: null` steht in der Abfrage: Die Datenbank
    // entscheidet in einem Schritt, ob dieser Aufruf der widerrufende war.
    expect(store.updateManyCalls).toEqual([
      {
        where: { tokenHash: hashLikeTokenIssuer(PRESENTED_REFRESH_TOKEN), revokedAt: null },
        data: { revokedAt: REFRESH_NOW },
      },
    ]);
    expect(JSON.stringify(store.updateManyCalls)).not.toContain(PRESENTED_REFRESH_TOKEN);
  });

  it('meldet keinen Fehler, wenn nichts zu widerrufen war', async () => {
    const { service, lines } = harness({ now: REFRESH_NOW, revocableCount: 0 });

    // Wiederholbar: Ein unbekannter Hash war nie ausgestellt, ein bereits
    // gesetztes `revokedAt` bleibt stehen — der zugesagte Endzustand gilt in
    // beiden Fällen schon. Eine Ablehnung verriete zudem, ob ein geratener
    // Tokenwert existiert.
    await expect(service.revokeRefreshToken(PRESENTED_REFRESH_TOKEN)).resolves.toBeUndefined();

    const [entry] = logEntries(lines);
    expect(entry?.step).toBe('auth.revoke');
    expect(entry?.reason).toBe('not-revocable');
  });

  it('protokolliert den Widerruf ohne Token und ohne Hash', async () => {
    const { service, lines } = harness({ now: REFRESH_NOW });

    await service.revokeRefreshToken(PRESENTED_REFRESH_TOKEN);

    const serialized = lines.join('\n');
    expect(logEntries(lines)[0]?.step).toBe('auth.revoke');
    expect(serialized).not.toContain(PRESENTED_REFRESH_TOKEN);
    expect(serialized).not.toContain(hashLikeTokenIssuer(PRESENTED_REFRESH_TOKEN));
  });

  it('macht das Token für die Erneuerung unbrauchbar', async () => {
    const { service } = harness({
      storedRefreshToken: {
        ...STORED_REFRESH_TOKEN,
        // Der Zustand, den der Widerruf hinterlässt.
        revokedAt: REFRESH_NOW,
      },
      now: new Date(REFRESH_NOW.getTime() + 1_000),
    });

    const error = await refreshRejectionOf(service);
    expect((error as SentenzaError).code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });
});

describe('AuthStore', () => {
  it('wird von PrismaService erfüllt', () => {
    // Die eigentliche Zusicherung ist der Type-Check dieser Zeile: Ändert
    // Prisma die Signatur von `upsert` oder `create`, schlägt er hier fehl
    // statt die Anmeldung zur Laufzeit. `PrismaService` wird dabei nicht
    // erzeugt, es wird keine Datenbankverbindung aufgebaut.
    const alsStore = (prisma: PrismaService): AuthStore => prisma;

    expect(alsStore).toBeTypeOf('function');
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 26: Ausgestellte Tokens tragen die
 * konfigurierten Gültigkeitsdauern.
 *
 * **Validates: Requirements 2.5, 2.6, 2.9**
 *
 * Die Aussage spricht über „die Antwort“ einer erfolgreichen Anmeldung. Sie
 * hängt deshalb an `AuthService` und nicht an `TokenIssuer`: Erst dort ist
 * sichtbar, dass beide Tokens samt beider Ablaufzeitpunkte in *derselben*
 * Antwort stehen, und nur dort lässt sich prüfen, dass die konfigurierten
 * Dauern unverwechselt bis zum Client durchlaufen. Der Aussteller selbst
 * kennt die Antwort nicht; seine Einzelheiten — HS256, `iss`, opakes Token,
 * Hash — prüft `token-issuer.test.ts`. Damit die Prüfung tatsächlich die
 * Ausstellung erreicht und keine Attrappe, tritt hier der echte `TokenIssuer`
 * an, mit einer festgelegten Zeit- und Zufallsquelle.
 *
 * Der Generator erzeugt die konfigurierbare Gültigkeitsdauer des
 * Access-Tokens über ihren gesamten zulässigen Bereich: ganze Minuten von 5
 * bis 60, die Schranken aus `ACCESS_TOKEN_TTL_MINUTES` in
 * `config/configuration.ts`, einschließlich beider Ränder und des Vorgabewerts
 * 15. Die Gültigkeitsdauer des Refresh-Tokens legt Requirement 2.5 auf genau
 * 30 Tage fest; ihr zulässiger Bereich ist dieser eine Wert, weshalb er fest
 * steht und nicht erzeugt wird. Der Ausstellungszeitpunkt wandert über mehrere
 * Jahre und ausdrücklich auch abseits von Sekundengrenzen: Er entsteht aus
 * ganzen Sekunden plus einem erzeugten Millisekundenanteil, der auch 0 sein
 * kann. Das trennt die beiden Rechnungen sauber — `exp` eines JWT ist auf
 * Sekunden festgelegt und verliert den Anteil, die Dauer des Refresh-Tokens
 * läuft in Millisekunden und behält ihn.
 *
 * Die Erneuerung gehört zur Aussage (Requirement 2.9) und ist deshalb Teil
 * desselben Durchlaufs: Nach der Anmeldung wird mit derselben Konfiguration
 * und derselben festgelegten Zeitquelle ein Access-Token erneuert, und auch
 * dieses muss die konfigurierte Gültigkeitsdauer tragen und gegen dasselbe
 * Geheimnis prüfbar sein. Damit ist ausgeschlossen, dass die Erneuerung eine
 * eigene, danebenlaufende Dauer verwendet.
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Klasse
 * wird von Hand instanziiert, die Prüfung des Google_ID_Token und der Zugriff
 * auf Prisma sind Attrappen. Die Ablage schreibt mit, womit jeder Durchlauf
 * zusätzlich festhält, dass der gespeicherte Ablaufzeitpunkt des
 * Refresh-Tokens derselbe ist wie der genannte.
 */

const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * MILLISECONDS_PER_SECOND;

/** Schranken aus `ACCESS_TOKEN_TTL_MINUTES` (`config/configuration.ts`). */
const ACCESS_TOKEN_TTL_MINUTES_MIN = 5;
const ACCESS_TOKEN_TTL_MINUTES_MAX = 60;

/** Requirement 2.5 legt diese Dauer fest; sie ist kein erzeugter Wert. */
const REFRESH_TOKEN_TTL_DAYS = 30;

/** Ausstellungszeitpunkte über mehrere Jahre, in ganzen Sekunden seit der Epoche. */
const ISSUED_AT_MIN_SECONDS = Math.floor(Date.UTC(2024, 0, 1) / MILLISECONDS_PER_SECOND);
const ISSUED_AT_MAX_SECONDS = Math.floor(Date.UTC(2031, 11, 31) / MILLISECONDS_PER_SECOND);

/** Ein erzeugter Ablauf einer erfolgreichen Anmeldung. */
interface IssuanceScenario {
  /** Konfigurierte Gültigkeitsdauer des Access-Tokens in Minuten. */
  readonly accessTokenTtlMinutes: number;
  /** Ausstellungszeitpunkt in ganzen Sekunden seit der Epoche. */
  readonly issuedAtSeconds: number;
  /** Millisekundenanteil des Ausstellungszeitpunkts, auch 0. */
  readonly issuedAtMilliseconds: number;
  readonly jwtSecret: string;
  readonly accountId: string;
}

const scenarioArb: fc.Arbitrary<IssuanceScenario> = fc.record({
  // Über den gesamten zulässigen Bereich, beide Ränder eingeschlossen.
  accessTokenTtlMinutes: fc.integer({
    min: ACCESS_TOKEN_TTL_MINUTES_MIN,
    max: ACCESS_TOKEN_TTL_MINUTES_MAX,
  }),
  issuedAtSeconds: fc.integer({ min: ISSUED_AT_MIN_SECONDS, max: ISSUED_AT_MAX_SECONDS }),
  issuedAtMilliseconds: fc.integer({ min: 0, max: 999 }),
  // Mehrere Geheimnisse, damit das Token nachweislich gegen das konfigurierte
  // geprüft wird und nicht gegen ein im Test fest verdrahtetes.
  jwtSecret: fc.constantFrom(
    'geheim-fuer-den-test-0123456789',
    'ein-zweites-geheimnis-abcdefghij',
    'x'.repeat(64),
  ),
  accountId: fc.uuid(),
});

describe('AuthService.signInWithGoogle (Property 26)', () => {
  it('gibt ein prüfbares Access-Token mit der konfigurierten Gültigkeitsdauer und ein Refresh-Token mit 30 Tagen samt beider Ablaufzeitpunkte zurück', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const now = new Date(
          scenario.issuedAtSeconds * MILLISECONDS_PER_SECOND + scenario.issuedAtMilliseconds,
        );
        const settings: TokenIssuerSettings = {
          jwtSecret: scenario.jwtSecret,
          accessTokenTtlMinutes: scenario.accessTokenTtlMinutes,
          refreshTokenTtlDays: REFRESH_TOKEN_TTL_DAYS,
        };
        const store = storeDouble({
          accountId: scenario.accountId,
          // Der Datensatz, den die Erneuerung im selben Durchlauf antrifft:
          // vorlagefähig, mit der Adresse des angemeldeten Kontos.
          storedRefreshToken: {
            id: 'refresh-token-1',
            userAccountId: scenario.accountId,
            expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY),
            revokedAt: null,
            userAccount: { id: scenario.accountId, email: IDENTITY.email },
          },
        });
        const { logger } = loggerCollecting();
        const service = new AuthService(
          store,
          verifierDouble(IDENTITY),
          // Die echte Ausstellung, nur Zeit- und Zufallsquelle festgelegt.
          new TokenIssuer(settings, () => now),
          SETTINGS,
          logger,
          () => now,
        );

        const tokens = await service.signInWithGoogle('ein-google-id-token');

        // Requirement 2.5: beide Tokens und beide Ablaufzeitpunkte stehen in
        // derselben Antwort, keiner davon fehlt.
        expect(tokens.accessToken).toBeTypeOf('string');
        expect(tokens.refreshToken).toBeTypeOf('string');
        expect(tokens.accessTokenExpiresAt).toBeInstanceOf(Date);
        expect(tokens.refreshTokenExpiresAt).toBeInstanceOf(Date);

        // Requirement 2.5, 2.10: das Access-Token ist prüfbar — gegen das
        // konfigurierte Geheimnis, mit HS256 und der Sentenza-Aussteller-
        // kennung, zum Ausstellungszeitpunkt.
        const payload = verifyJwt(tokens.accessToken, scenario.jwtSecret, {
          algorithms: [ACCESS_TOKEN_ALGORITHM],
          issuer: ACCESS_TOKEN_ISSUER,
          clockTimestamp: scenario.issuedAtSeconds,
        });
        expect(payload).toMatchObject({ sub: scenario.accountId, iss: ACCESS_TOKEN_ISSUER });

        // Requirement 2.6: die Gültigkeitsdauer ist der konfigurierte Wert,
        // aus dem Token selbst gelesen.
        const claims = decodeJwt(tokens.accessToken) as { iat: number; exp: number };
        expect(claims.iat).toBe(scenario.issuedAtSeconds);
        expect(claims.exp - claims.iat).toBe(scenario.accessTokenTtlMinutes * SECONDS_PER_MINUTE);

        // Requirement 2.5: der genannte Ablaufzeitpunkt ist genau der Anspruch
        // im Token, nicht eine zweite, danebenlaufende Rechnung. Der
        // Millisekundenanteil des Ausstellungszeitpunkts fällt dabei weg, weil
        // `exp` auf Sekunden festgelegt ist.
        expect(tokens.accessTokenExpiresAt.getTime()).toBe(claims.exp * MILLISECONDS_PER_SECOND);
        expect(tokens.accessTokenExpiresAt.getTime() - now.getTime()).toBe(
          scenario.accessTokenTtlMinutes * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND -
            scenario.issuedAtMilliseconds,
        );

        // Requirement 2.5: 30 Tage, hier in Millisekunden gerechnet und
        // deshalb unabhängig von Zeitzone und Sommerzeit.
        expect(tokens.refreshTokenExpiresAt.getTime() - now.getTime()).toBe(
          REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
        );

        // Der genannte Ablaufzeitpunkt ist derselbe, der abgelegt wurde —
        // sonst wäre das Token früher oder später nicht mehr vorlagefähig, als
        // der Client annimmt.
        expect(store.createCalls).toHaveLength(1);
        expect(store.createCalls[0]?.data.expiresAt).toEqual(tokens.refreshTokenExpiresAt);

        // Requirement 2.9: das erneuerte Access-Token trägt dieselbe
        // konfigurierte Gültigkeitsdauer und ist gegen dasselbe Geheimnis
        // prüfbar; ein Refresh-Token ist nicht Teil der Antwort, weil keine
        // Rotation stattfindet.
        const renewed = await service.refreshAccessToken(tokens.refreshToken);

        verifyJwt(renewed.accessToken, scenario.jwtSecret, {
          algorithms: [ACCESS_TOKEN_ALGORITHM],
          issuer: ACCESS_TOKEN_ISSUER,
          clockTimestamp: scenario.issuedAtSeconds,
        });

        const renewedClaims = decodeJwt(renewed.accessToken) as {
          sub: string;
          iat: number;
          exp: number;
        };
        expect(renewedClaims.sub).toBe(scenario.accountId);
        expect(renewedClaims.exp - renewedClaims.iat).toBe(
          scenario.accessTokenTtlMinutes * SECONDS_PER_MINUTE,
        );
        expect(renewed.accessTokenExpiresAt.getTime()).toBe(
          renewedClaims.exp * MILLISECONDS_PER_SECOND,
        );
        expect(Object.keys(renewed)).toEqual(['accessToken', 'accessTokenExpiresAt']);
      }),
      { numRuns: 100 },
    );
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 27: Je Google-Subject-Kennung
 * existiert genau ein Benutzerkonto.
 *
 * **Validates: Requirements 2.7, 2.8**
 *
 * Diese Eigenschaft läuft gegen die echte Testdatenbank, und das ist keine
 * Bequemlichkeit, sondern die Aussage selbst. Sie spricht darüber, wieviele
 * Benutzerkonten mit einer Subject-Kennung *existieren* — eine Aussage über
 * den persistierten Bestand, nicht über einen Aufruf. Die Eindeutigkeit
 * entsteht aus `googleSubject String @unique` in `schema.prisma` und aus der
 * Wahl von `upsert` als einzigem Schreibzugriff; eine Attrappe könnte beides
 * nur behaupten. Der Beispieltest weiter oben hält fest, dass `AuthService`
 * genau ein `upsert` mit den richtigen Argumenten absetzt; ob daraus im
 * Datenbestand genau ein Konto wird, entscheidet die Datenbank. design.md
 * kennzeichnet die Eigenschaft deshalb als **[db]**.
 *
 * Der Generator erzeugt mehrere verschiedene Google-Subject-Kennungen in
 * beiden in der Praxis auftretenden Formen — die 21-stellige Zahlenkette von
 * Google und eine UUID-artige Kennung — und dazu eine Folge von Anmeldungen,
 * die in der erzeugten Reihenfolge abgearbeitet wird. Jede Anmeldung wählt
 * ihre Subject-Kennung aus den erzeugten und ihre E-Mail-Adresse aus der
 * Freigabeliste, sodass dieselbe Kennung mehrfach und mit wechselnden Adressen
 * vorkommt und die Anmeldungen verschiedener Kennungen sich beliebig
 * verschränken. Erzeugte Kennungen, die in der Folge nicht vorkommen, sind
 * Absicht: An ihnen hält der Test fest, dass keine Anmeldung ein Konto zu
 * einer fremden Kennung anlegt.
 *
 * Geprüft wird je Subject-Kennung dreierlei: genau ein Konto, dessen Adresse
 * die der *letzten* Anmeldung ist (Requirement 2.8), und genau so viele
 * Refresh-Token-Datensätze an diesem einen Konto wie Anmeldungen zu dieser
 * Kennung. Das Dritte ist der Nachweis, dass die weiteren Anmeldungen
 * tatsächlich das bestehende Konto verwendet haben und nicht bloß ein zweites
 * Konto unbemerkt geblieben ist.
 *
 * Kein Netzzugriff und keine Nest-DI: Die Prüfung des Google_ID_Token ist eine
 * Attrappe, die die Folge der erzeugten Identitäten der Reihe nach liefert;
 * `AuthService` bekommt den Prisma-Client der Testdatenbank unmittelbar als
 * `AuthStore`. Die Tokenausstellung ist die echte — ihre Refresh-Tokens sind
 * Zufallswerte, und nur damit sind mehrere Anmeldungen gegen das eindeutige
 * `RefreshToken.tokenHash` überhaupt ablegbar.
 *
 * `numRuns: 100` wie überall; jeder Durchlauf setzt den Bestand zu Beginn
 * selbst zurück, damit die Durchläufe voneinander unabhängig sind.
 */

/** Die Freigabeliste dieses Tests; die Anmeldungen wählen ihre Adresse daraus. */
const PROPERTY_27_EMAILS = [
  'erste.adresse@example.com',
  'zweite.adresse@example.com',
  'dritte.adresse@example.com',
] as const;

const PROPERTY_27_SETTINGS: AuthServiceSettings = { allowedEmails: [...PROPERTY_27_EMAILS] };

/**
 * Die Tokenausstellung spielt hier keine Rolle; Property 26 prüft sie. Die
 * Werte sind deshalb fest und liegen im zulässigen Bereich.
 */
const PROPERTY_27_ISSUER_SETTINGS: TokenIssuerSettings = {
  jwtSecret: 'geheim-fuer-den-test-0123456789',
  accessTokenTtlMinutes: 15,
  refreshTokenTtlDays: 30,
};

/**
 * Beide in der Praxis auftretenden Formen einer Google-Subject-Kennung: die
 * 21-stellige Zahlenkette, die Google ausstellt, und eine UUID-artige Kennung
 * als Absicherung dagegen, dass irgendwo eine Zahl unterstellt wird.
 */
const googleSubjectArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 1, max: 999_999_999 }).map((n) => `1${String(n).padStart(20, '0')}`),
  fc.uuid(),
);

/** Eine einzelne Anmeldung innerhalb der erzeugten Folge. */
interface SignInEvent {
  /** Index in die erzeugten Subject-Kennungen; dieselbe Kennung darf mehrfach vorkommen. */
  readonly subjectIndex: number;
  readonly email: string;
}

interface SignInSequence {
  readonly subjects: readonly string[];
  readonly signIns: readonly SignInEvent[];
}

const signInSequenceArb: fc.Arbitrary<SignInSequence> = fc
  .uniqueArray(googleSubjectArb, { minLength: 1, maxLength: 3 })
  .chain((subjects) =>
    fc.record({
      subjects: fc.constant(subjects),
      signIns: fc.array(
        fc.record({
          subjectIndex: fc.nat({ max: subjects.length - 1 }),
          email: fc.constantFrom(...PROPERTY_27_EMAILS),
        }),
        { minLength: 1, maxLength: 6 },
      ),
    }),
  );

/**
 * Prüfung des Google_ID_Token als Attrappe, die die erzeugten Identitäten in
 * genau der erzeugten Reihenfolge liefert. Ein Aufruf über die Folge hinaus
 * wäre ein Fehler im Test selbst und wird als solcher gemeldet, nicht
 * stillschweigend zur letzten Identität.
 */
function verifierSequence(identities: readonly GoogleIdentity[]): GoogleIdentityVerifier {
  let nextIndex = 0;

  return {
    verify() {
      const identity = identities[nextIndex];
      nextIndex += 1;

      if (!identity) {
        return Promise.reject(
          new Error(
            `Die Anmeldung hat die Prüfung ${nextIndex} Mal aufgerufen, die erzeugte Folge ` +
              `umfasst aber nur ${identities.length} Identitäten.`,
          ),
        );
      }

      return Promise.resolve(identity);
    },
  };
}

/**
 * Hundert Durchläufe mit Reset und bis zu sechs Anmeldungen gegen eine echte
 * Datenbank brauchen mehr als die voreingestellten fünf Sekunden von Vitest.
 */
const PROPERTY_27_TIMEOUT_MS = 120_000;

describe('AuthService.signInWithGoogle (Property 27)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestDatabaseClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'hinterlässt je Google-Subject-Kennung genau ein Benutzerkonto mit der Adresse der letzten Anmeldung',
    async () => {
      await fc.assert(
        fc.asyncProperty(signInSequenceArb, async ({ subjects, signIns }) => {
          await resetDatabase(prisma);

          const identities: GoogleIdentity[] = signIns.map((event) => {
            const subject = subjects[event.subjectIndex];
            if (subject === undefined) {
              throw new Error('Der Generator hat einen Index außerhalb der Kennungen erzeugt.');
            }

            return { subject, email: event.email, emailVerified: true };
          });

          const { logger } = loggerCollecting();
          const service = new AuthService(
            prisma,
            verifierSequence(identities),
            new TokenIssuer(PROPERTY_27_ISSUER_SETTINGS),
            PROPERTY_27_SETTINGS,
            logger,
          );

          // Die Anmeldungen laufen der Reihe nach, nicht gleichzeitig: Die
          // Eigenschaft spricht von einer *Folge*, und die letzte Adresse ist
          // nur bei festgelegter Reihenfolge bestimmt.
          for (let index = 0; index < identities.length; index += 1) {
            await service.signInWithGoogle('ein-google-id-token');
          }

          // Erwartung je Subject-Kennung: die Adresse der letzten Anmeldung und
          // die Anzahl ihrer Anmeldungen. Kennungen ohne Anmeldung stehen
          // absichtlich nicht darin.
          const expectedEmail = new Map<string, string>();
          const expectedSignIns = new Map<string, number>();
          for (const identity of identities) {
            expectedEmail.set(identity.subject, identity.email);
            expectedSignIns.set(identity.subject, (expectedSignIns.get(identity.subject) ?? 0) + 1);
          }

          const accounts = await prisma.userAccount.findMany({
            include: { refreshTokens: true },
          });

          // Kein Konto zu einer Kennung, die sich nicht angemeldet hat, und
          // keines zu viel insgesamt.
          expect(accounts).toHaveLength(expectedEmail.size);

          for (const [subject, email] of expectedEmail) {
            const matching = accounts.filter((account) => account.googleSubject === subject);

            // Requirement 2.7, 2.8: genau eines, auch nach mehreren Anmeldungen.
            expect(matching).toHaveLength(1);
            // Requirement 2.8: die gespeicherte Adresse ist die der letzten
            // Anmeldung, zeichengleich zum Token.
            expect(matching[0]?.email).toBe(email);
            // Requirement 2.8: jede weitere Anmeldung hat dieses bestehende
            // Konto verwendet — ihre Refresh-Tokens hängen daran.
            expect(matching[0]?.refreshTokens).toHaveLength(expectedSignIns.get(subject) ?? 0);
          }
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_27_TIMEOUT_MS,
  );
});

/**
 * Feature: backend-busuu-ingestion, Property 28: Ein nicht vorlagefähiges
 * Refresh-Token führt zu keiner Erneuerung.
 *
 * **Validates: Requirements 2.14**
 *
 * Diese Eigenschaft läuft gegen die echte Testdatenbank, so wie design.md sie
 * als **[db]** kennzeichnet. Der Grund liegt in der Aussage: Sie spricht
 * darüber, ob ein Token „von Auth_Service ausgestellt“ wurde, „abgelaufen“
 * oder „widerrufen“ ist und ob es „einem bestehenden Benutzerkonto“ zugeordnet
 * ist. Alle vier Merkmale sind Eigenschaften des persistierten Bestands, nicht
 * eines Aufrufs: Der Hash steht im eindeutigen Index `RefreshToken.tokenHash`,
 * `revokedAt` setzt der Widerruf, und die Zuordnung zum Konto hält ein
 * Fremdschlüssel mit `onDelete: Cascade`. Eine Attrappe könnte jeden dieser
 * Zustände nur behaupten — sie würde genau die Frage beantworten, die die
 * Eigenschaft stellt. Die Beispieltests weiter oben halten die vier Gründe
 * bereits mit vorgegebenen Datensätzen fest; hier entsteht der Zustand
 * stattdessen so, wie er im Betrieb entsteht.
 *
 * Der Generator durchmisst den gesamten Raum der vorgelegten Tokens als Menge
 * der hergestellten Defekte — die vier aus Requirement 2.14, einzeln und in
 * jeder Kombination:
 *
 * - `foreign`: Vorgelegt wird ein nie ausgestelltes Token statt des
 *   ausgestellten. Es tritt in der Form eines echten Tokens auf (32 Byte
 *   base64url) und ausdrücklich auch in Formen, die keines sein können — die
 *   leere Zeichenkette, beliebige Zeichenketten, eine sehr lange. In jedem
 *   Durchlauf existiert dabei ein gültiges Token in der Ablage: Ein fremder
 *   Wert darf auch dann nicht durchkommen, wenn es etwas zu treffen gäbe.
 * - `revoked`: Das ausgestellte Token wurde widerrufen, über
 *   `revokeRefreshToken` und damit auf demselben Weg wie im Betrieb.
 * - `account-removed`: Das Benutzerkonto wurde nach der Ausstellung entfernt.
 * - `expired`: Der Erneuerungszeitpunkt liegt auf oder hinter dem Ablauf.
 *
 * Die leere Defektmenge ist das vorlagefähige Token und gehört bewusst in
 * denselben Generator: Ohne sie wäre die Eigenschaft von einer Erneuerung
 * erfüllt, die grundsätzlich jedes Token ablehnt, und würde nichts aussagen.
 * Sie steht deshalb als eigener Zweig neben den Defektmengen und nicht als
 * Zufall aus unabhängigen Merkmalen — so trifft jeder Lauf beide Seiten,
 * statt die vorlagefähige Kombination in einem von sechzehn Fällen zu
 * erwischen.
 *
 * Der Abstand des Erneuerungszeitpunkts zum Ablauf wird dazu ohne Vorzeichen
 * erzeugt — die Ränder 0, 1 ms, 1 s, 1 Tag und 30 Tage und dazwischen frei
 * gewählte Werte — und erst durch `expired` in Richtung Vergangenheit oder
 * Zukunft gelegt. Der Abstand 0 bedeutet „genau auf dem Ablauf“ und ist
 * bereits Ablauf; ein noch vorlagefähiges Token liegt deshalb mindestens eine
 * Millisekunde davor.
 *
 * Ein entferntes Konto ist im Datenbestand nicht von einem nie ausgestellten
 * Token zu unterscheiden, und das ist kein Mangel des Tests: `onDelete:
 * Cascade` in `schema.prisma` nimmt die Refresh-Tokens des Kontos mit, ein
 * Datensatz mit ins Leere zeigendem Fremdschlüssel kann gar nicht entstehen.
 * Der protokollierte Grund lautet dann `not-issued` statt `unassigned` — die
 * von Requirement 2.14 zugesagte Wirkung, Ablehnung mit `UNAUTHENTICATED` und
 * kein neues Access-Token, ist in beiden Fällen dieselbe. Geprüft wird deshalb
 * die Wirkung, und vom Protokoll nur, dass der genannte Grund einer der vier
 * aufgezählten ist.
 *
 * „Es wird kein neues Sentenza_Access_Token ausgestellt“ ist an einer
 * ausbleibenden Antwort nicht ablesbar, deshalb zählt ein Umschlag um die
 * echte Tokenausstellung die Aufrufe von `issueAccessToken` mit. Dazu hält
 * jeder Durchlauf fest, dass der Bestand durch die Erneuerung unverändert
 * bleibt — auch im Erfolgsfall, denn eine Rotation findet nicht statt.
 *
 * Kein Netzzugriff und keine Nest-DI: Die Prüfung des Google_ID_Token ist eine
 * Attrappe, `AuthService` bekommt den Prisma-Client der Testdatenbank
 * unmittelbar als `AuthStore`. Die Zeitquelle ist eine im Durchlauf
 * fortgestellte Variable, die Ausstellung und Erneuerung gemeinsam lesen;
 * damit ist ein 30 Tage altes Token ohne Warten prüfbar. Jeder der 100
 * Durchläufe setzt den Bestand zu Beginn selbst zurück.
 */

/** Die Identität, mit der jeder Durchlauf sein Refresh-Token ausstellt. */
const PROPERTY_28_IDENTITY: GoogleIdentity = {
  subject: '110000000000000000001',
  email: 'nutzer@example.com',
  emailVerified: true,
};

/**
 * Die Freigabeliste enthält die Adresse: Ein Verstoß dagegen ergibt
 * `FORBIDDEN` und gehört zu Property 25, nicht hierher.
 */
const PROPERTY_28_SETTINGS: AuthServiceSettings = { allowedEmails: [PROPERTY_28_IDENTITY.email] };

/** Die Tokenausstellung selbst prüft Property 26; die Werte liegen im zulässigen Bereich. */
const PROPERTY_28_ISSUER_SETTINGS: TokenIssuerSettings = {
  jwtSecret: 'geheim-fuer-den-test-0123456789',
  accessTokenTtlMinutes: 15,
  refreshTokenTtlDays: REFRESH_TOKEN_TTL_DAYS,
};

/** Ablauf des ausgestellten Refresh-Tokens, auf die Sekunde; Bezugspunkt aller Abstände. */
const PROPERTY_28_EXPIRES_AT = new Date('2026-03-31T10:20:30.000Z');

/** Ausstellungszeitpunkt, 30 Tage vor dem Ablauf (Requirement 2.5). */
const PROPERTY_28_ISSUED_AT = new Date(
  PROPERTY_28_EXPIRES_AT.getTime() - REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
);

/** Zeitpunkt eines Widerrufs: zwischen Ausstellung und Ablauf. */
const PROPERTY_28_REVOKED_AT = new Date(PROPERTY_28_ISSUED_AT.getTime() + 60 * 60 * 1_000);

/** Die vier Gründe aus Requirement 2.14; einer von ihnen steht im Protokolleintrag. */
const PROPERTY_28_REASONS: readonly RefreshTokenRejectionReason[] = [
  'not-issued',
  'revoked',
  'expired',
  'unassigned',
];

/**
 * Ein nie ausgestelltes Token: in der Form eines echten und ausdrücklich auch
 * in Formen, die keines sein können.
 */
const foreignRefreshTokenArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .uint8Array({ minLength: REFRESH_TOKEN_BYTES, maxLength: REFRESH_TOKEN_BYTES })
    .map((bytes) => Buffer.from(bytes).toString('base64url')),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 200 }),
  fc.constant('x'.repeat(4_096)),
);

/**
 * Abstand des Erneuerungszeitpunkts zum Ablauf, ohne Vorzeichen: Die Richtung
 * legt erst der Defekt `expired` fest.
 */
const expiryDistanceMsArb: fc.Arbitrary<number> = fc.oneof(
  fc.constantFrom(
    0,
    1,
    MILLISECONDS_PER_SECOND,
    MILLISECONDS_PER_DAY,
    REFRESH_TOKEN_TTL_DAYS * MILLISECONDS_PER_DAY,
  ),
  fc.integer({ min: 0, max: 2 * MILLISECONDS_PER_DAY }),
);

/** Die vier Gründe aus Requirement 2.14, wie der Test sie herstellt. */
type RefreshTokenDefect = 'foreign' | 'revoked' | 'account-removed' | 'expired';

/** Ein erzeugter Zustand des vorgelegten Refresh-Tokens. */
interface PresentedRefreshToken {
  /** Die hergestellten Defekte; die leere Menge ist das vorlagefähige Token. */
  readonly defects: readonly RefreshTokenDefect[];
  readonly foreignToken: string;
  readonly expiryDistanceMs: number;
}

const presentedRefreshTokenArb: fc.Arbitrary<PresentedRefreshToken> = fc.record({
  defects: fc.oneof(
    // Das vorlagefähige Token als eigener Zweig: Ohne es sagt der Durchlauf
    // nichts aus.
    fc.constant<readonly RefreshTokenDefect[]>([]),
    fc.uniqueArray(
      fc.constantFrom<RefreshTokenDefect>('foreign', 'revoked', 'account-removed', 'expired'),
      { minLength: 1, maxLength: 4 },
    ),
  ),
  foreignToken: foreignRefreshTokenArb,
  expiryDistanceMs: expiryDistanceMsArb,
});

/** Die Tokenausstellung, die ihre ausgestellten Access-Tokens mitzählt. */
interface CountingIssuer extends AuthTokenIssuer {
  readonly issuedAccessTokens: number;
}

/**
 * Umschlag um die echte Ausstellung: Er gibt jeden Aufruf unverändert weiter
 * und hält nur fest, wie oft ein Access-Token ausgestellt wurde. Damit ist
 * „es wird kein neues Sentenza_Access_Token ausgestellt“ prüfbar, ohne die
 * Ausstellung selbst zu ersetzen.
 */
function countingIssuer(inner: AuthTokenIssuer): CountingIssuer {
  let issuedAccessTokens = 0;

  return {
    get issuedAccessTokens() {
      return issuedAccessTokens;
    },
    issueAccessToken(userAccountId) {
      issuedAccessTokens += 1;
      return inner.issueAccessToken(userAccountId);
    },
    issueRefreshToken() {
      return inner.issueRefreshToken();
    },
    hashRefreshToken(token) {
      return inner.hashRefreshToken(token);
    },
  };
}

/** Der Teil des Bestands, den eine Erneuerung nicht verändern darf. */
interface StoredAuthState {
  readonly accounts: { id: string; googleSubject: string; email: string }[];
  readonly refreshTokens: {
    tokenHash: string;
    userAccountId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  }[];
}

async function readStoredAuthState(prisma: PrismaClient): Promise<StoredAuthState> {
  return {
    accounts: await prisma.userAccount.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, googleSubject: true, email: true },
    }),
    refreshTokens: await prisma.refreshToken.findMany({
      orderBy: { tokenHash: 'asc' },
      select: { tokenHash: true, userAccountId: true, expiresAt: true, revokedAt: true },
    }),
  };
}

/**
 * Hundert Durchläufe mit Reset, Anmeldung und Erneuerung gegen eine echte
 * Datenbank brauchen mehr als die voreingestellten fünf Sekunden von Vitest.
 */
const PROPERTY_28_TIMEOUT_MS = 120_000;

describe('AuthService.refreshAccessToken (Property 28)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestDatabaseClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'lehnt jedes nicht vorlagefähige Refresh-Token mit UNAUTHENTICATED ab und stellt kein Access-Token aus',
    async () => {
      await fc.assert(
        fc.asyncProperty(presentedRefreshTokenArb, async (scenario) => {
          await resetDatabase(prisma);

          // Eine im Durchlauf fortgestellte Zeitquelle, die Ausstellung und
          // Erneuerung gemeinsam lesen: So ist ein 30 Tage altes Token ohne
          // Warten und ohne Verstellen der Systemuhr prüfbar.
          let clock = PROPERTY_28_ISSUED_AT;
          const issuer = countingIssuer(new TokenIssuer(PROPERTY_28_ISSUER_SETTINGS, () => clock));
          const { logger, lines } = loggerCollecting();
          const service = new AuthService(
            prisma,
            verifierDouble(PROPERTY_28_IDENTITY),
            issuer,
            PROPERTY_28_SETTINGS,
            logger,
            () => clock,
          );

          // Ein tatsächlich ausgestelltes Token, auf dem normalen Weg: Nur die
          // Anmeldung nennt den Tokenwert, in der Ablage steht allein sein
          // Hash.
          const issued = await service.signInWithGoogle('ein-google-id-token');
          expect(issued.refreshTokenExpiresAt).toEqual(PROPERTY_28_EXPIRES_AT);

          const account = await prisma.userAccount.findUniqueOrThrow({
            where: { googleSubject: PROPERTY_28_IDENTITY.subject },
          });

          if (scenario.defects.includes('revoked')) {
            clock = PROPERTY_28_REVOKED_AT;
            await service.revokeRefreshToken(issued.refreshToken);
          }

          if (scenario.defects.includes('account-removed')) {
            // `onDelete: Cascade` nimmt die Refresh-Tokens des Kontos mit; ein
            // Datensatz ohne bestehendes Konto kann im Bestand nicht stehen.
            await prisma.userAccount.delete({ where: { id: account.id } });
          }

          const presentedToken = scenario.defects.includes('foreign')
            ? scenario.foreignToken
            : issued.refreshToken;

          // Der Abstand 0 ist bereits Ablauf, ein noch gültiges Token liegt
          // deshalb mindestens eine Millisekunde davor.
          const expiryOffsetMs = scenario.defects.includes('expired')
            ? scenario.expiryDistanceMs
            : -(scenario.expiryDistanceMs + 1);
          clock = new Date(PROPERTY_28_EXPIRES_AT.getTime() + expiryOffsetMs);

          const stateBefore = await readStoredAuthState(prisma);
          const accessTokensBefore = issuer.issuedAccessTokens;

          // Vorlagefähig ist genau das Token ohne Defekt; jeder Defekt fällt
          // unter Requirement 2.14.
          const presentable = scenario.defects.length === 0;

          if (presentable) {
            const renewed = await service.refreshAccessToken(presentedToken);

            // Requirement 2.9: genau ein neues, prüfbares Access-Token auf die
            // interne Konto-Kennung.
            expect(issuer.issuedAccessTokens - accessTokensBefore).toBe(1);
            const payload = verifyJwt(renewed.accessToken, PROPERTY_28_ISSUER_SETTINGS.jwtSecret, {
              algorithms: [ACCESS_TOKEN_ALGORITHM],
              issuer: ACCESS_TOKEN_ISSUER,
              clockTimestamp: Math.floor(clock.getTime() / MILLISECONDS_PER_SECOND),
            });
            expect(payload).toMatchObject({ sub: account.id });
          } else {
            let caught: unknown;
            try {
              await service.refreshAccessToken(presentedToken);
            } catch (error) {
              caught = error;
            }

            // Requirement 2.14: `UNAUTHENTICATED`, für alle Gründe
            // gleichlautend, und kein neues Access-Token.
            expect(caught).toBeInstanceOf(SentenzaError);
            expect((caught as SentenzaError).code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
            expect((caught as SentenzaError).message).toBe('Das Refresh-Token ist ungültig.');
            expect(issuer.issuedAccessTokens).toBe(accessTokensBefore);

            // Der Grund steht ausschließlich im Protokoll (Requirement 9.3)
            // und ist einer der vier aufgezählten. *Welcher* es ist, prüfen
            // die Beispieltests weiter oben: Ein entferntes Konto ist im
            // Bestand nicht von einem nie ausgestellten Token zu
            // unterscheiden.
            const entry = logEntries(lines).at(-1);
            expect(entry?.step).toBe('auth.refresh');
            expect(PROPERTY_28_REASONS).toContain(entry?.reason);
          }

          // In beiden Fällen unverändert: keine Rotation, kein neuer
          // Datensatz, kein nachträglich gesetztes `revokedAt` und kein
          // zusätzliches Konto.
          expect(await readStoredAuthState(prisma)).toEqual(stateBefore);
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_28_TIMEOUT_MS,
  );
});
