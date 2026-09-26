import 'reflect-metadata';

import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { sign as signJwt, verify as verifyJwt } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../common/logger.js';
import type { AccessTokenStore, AuthenticatedAccount } from '../authenticated-account.js';
import {
  ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS,
  ACCESS_TOKEN_STRATEGY_NAME,
  accessTokenStrategyOptions,
  JwtStrategy,
} from '../jwt.strategy.js';
import { ACCESS_TOKEN_ALGORITHM, ACCESS_TOKEN_ISSUER, TokenIssuer } from '../token-issuer.js';

/**
 * Ablauf- und Fehlerfalltests für `JwtStrategy` (Requirement 2.10, 2.11).
 *
 * Kein Nest-Container im Spiel: Vitest übersetzt TypeScript mit esbuild, und
 * esbuild erzeugt kein `emitDecoratorMetadata` — Nest könnte die
 * Konstruktorabhängigkeiten hier also nicht auflösen. Nach dem Vorbild von
 * `health.controller.test.ts` wird die Klasse deshalb von Hand instanziiert und
 * die Datenschicht durch ein Double ersetzt. Kein Netzzugriff, keine Datenbank.
 *
 * Die Prüfung ist zweigeteilt, und der Test folgt dieser Teilung:
 *
 * - Signatur, Verfahren, `iss` und `exp` prüft `jsonwebtoken` anhand der von
 *   `accessTokenStrategyOptions` gelieferten Optionen. Der Test führt dieselbe
 *   Prüfung mit genau diesen Optionen aus, statt sie über Passport und eine
 *   HTTP-Anfrage anzustoßen: Geprüft wird damit, was wir festlegen, nicht die
 *   Bibliothek.
 * - Die Zuordnung zu einem bestehenden Benutzerkonto prüft `validate`.
 */

const JWT_SECRET = 'geheim-fuer-den-test';
const OTHER_SECRET = 'ein-anderes-geheimnis';
const SETTINGS = { jwtSecret: JWT_SECRET } as const;

const ACCOUNT: AuthenticatedAccount = { id: 'konto-1', email: 'lernende@example.com' };

/** Schreibt Protokolleinträge ins Nichts, damit sie nicht im Testlauf erscheinen. */
const silentLogger = () => createLogger({ component: 'auth', sink: () => undefined });

/** Kontospeicher, der genau die übergebenen Konten kennt. */
function storeWith(...accounts: AuthenticatedAccount[]): AccessTokenStore {
  return {
    userAccount: {
      findUnique: async ({ where }) => accounts.find((account) => account.id === where.id) ?? null,
    },
  };
}

function strategyFor(store: AccessTokenStore): JwtStrategy {
  return new JwtStrategy(store, SETTINGS, silentLogger());
}

/** Ansprüche eines Access-Tokens, wie `TokenIssuer` sie setzt. */
function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1_000);

  return {
    sub: ACCOUNT.id,
    iss: ACCESS_TOKEN_ISSUER,
    iat: nowSeconds,
    exp: nowSeconds + 900,
    ...overrides,
  };
}

/**
 * Prüft ein Token mit genau den Optionen, die die Strategie verwendet, und
 * meldet, ob es angenommen wurde. `jsonwebtoken` ist dabei derselbe Prüfer, den
 * `passport-jwt` aufruft.
 */
function acceptedByOptions(token: string): boolean {
  const options = accessTokenStrategyOptions(SETTINGS);

  try {
    verifyJwt(token, options.secretOrKey, {
      algorithms: options.algorithms,
      issuer: options.issuer,
      ...options.jsonWebTokenOptions,
    });

    return true;
  } catch {
    return false;
  }
}

/** Nimmt einen erwarteten `SentenzaError` ab und gibt ihn zur weiteren Prüfung zurück. */
async function rejectionOf(operation: Promise<unknown>): Promise<SentenzaError> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof SentenzaError) {
      return error;
    }

    expect.fail(`Erwartet war ein SentenzaError, beobachtet wurde: ${String(error)}`);
  }

  return expect.fail('Erwartet war eine Ablehnung, die Prüfung ging jedoch durch.');
}

describe('Prüfoptionen des Access-Tokens', () => {
  it('lässt allein HS256 und den Aussteller `sentenza` zu', () => {
    const options = accessTokenStrategyOptions(SETTINGS);

    // Requirement 2.10: geprüft wird gegen `JWT_SECRET`, nicht gegen einen
    // beliebigen Schlüssel, und ausschließlich mit dem Verfahren, mit dem
    // `TokenIssuer` signiert.
    expect(options.secretOrKey).toBe(JWT_SECRET);
    expect(options.algorithms).toEqual([ACCESS_TOKEN_ALGORITHM]);
    expect(options.issuer).toBe(ACCESS_TOKEN_ISSUER);
    expect(options.jsonWebTokenOptions.clockTolerance).toBe(ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS);
  });

  it('liest das Token allein aus `Authorization: Bearer …`', () => {
    const { jwtFromRequest } = accessTokenStrategyOptions(SETTINGS);

    expect(jwtFromRequest({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe(
      'abc.def.ghi',
    );
    // Ein Token an anderer Stelle wird nicht gelesen und gilt damit als fehlend.
    expect(jwtFromRequest({ headers: {}, query: { access_token: 'abc.def.ghi' } })).toBeNull();
  });

  it('nimmt ein von `TokenIssuer` ausgestelltes Token an', () => {
    // Gegenprobe zu allen folgenden Ablehnungen: Die Optionen sind zu der
    // Ausstellung passend, nicht generell ablehnend.
    const issued = new TokenIssuer({
      jwtSecret: JWT_SECRET,
      accessTokenTtlMinutes: 15,
      refreshTokenTtlDays: 30,
    }).issueAccessToken(ACCOUNT.id);

    expect(acceptedByOptions(issued.token)).toBe(true);
  });

  it('lehnt ein mit fremdem Geheimnis signiertes Token ab', () => {
    const token = signJwt(claims(), OTHER_SECRET, { algorithm: ACCESS_TOKEN_ALGORITHM });

    expect(acceptedByOptions(token)).toBe(false);
  });

  it('lehnt ein Token mit fremdem Aussteller ab', () => {
    const token = signJwt(claims({ iss: 'jemand-anderes' }), JWT_SECRET, {
      algorithm: ACCESS_TOKEN_ALGORITHM,
    });

    expect(acceptedByOptions(token)).toBe(false);
  });

  it('lehnt ein unsigniertes Token ab', () => {
    // Ohne `algorithms` in den Optionen wäre `none` ein gültiges Verfahren und
    // jedes selbst geschriebene Token angenommen.
    const token = signJwt(claims(), '', { algorithm: 'none' });

    expect(acceptedByOptions(token)).toBe(false);
  });

  it('duldet einen um weniger als 60 Sekunden überschrittenen Ablauf', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = signJwt(claims({ exp: nowSeconds - 30 }), JWT_SECRET, {
      algorithm: ACCESS_TOKEN_ALGORITHM,
    });

    // Requirement 2.11: abgelehnt wird erst ein um *mehr als* 60 Sekunden
    // überschrittener Ablaufzeitpunkt.
    expect(acceptedByOptions(token)).toBe(true);
  });

  it('lehnt einen um mehr als 60 Sekunden überschrittenen Ablauf ab', () => {
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const token = signJwt(claims({ exp: nowSeconds - 120 }), JWT_SECRET, {
      algorithm: ACCESS_TOKEN_ALGORITHM,
    });

    expect(acceptedByOptions(token)).toBe(false);
  });
});

describe('Zuordnung des Access-Tokens zu einem Benutzerkonto', () => {
  it('gibt das Konto zu `sub` zurück', async () => {
    const account = await strategyFor(storeWith(ACCOUNT)).validate(claims());

    // Requirement 2.10: das ermittelte Konto wird bereitgestellt.
    expect(account).toEqual({ id: ACCOUNT.id, email: ACCOUNT.email });
  });

  it('gibt ausschließlich Kennung und E-Mail-Adresse weiter', async () => {
    const store = storeWith({
      ...ACCOUNT,
      // Ein Datensatz, wie Prisma ihn liefert: mehr Felder als gebraucht.
      googleSubject: 'google-subject-1',
    } as AuthenticatedAccount);

    expect(Object.keys(await strategyFor(store).validate(claims()))).toEqual(['id', 'email']);
  });

  it('lehnt ein Token ohne bestehendes Benutzerkonto ab', async () => {
    const store = storeWith(ACCOUNT);
    const rejection = await rejectionOf(
      strategyFor(store).validate(claims({ sub: 'geloeschtes-konto' })),
    );

    // Requirement 2.11: nicht zuordenbar ⇒ `UNAUTHENTICATED`.
    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });

  it('lehnt ein Token ohne `sub` ab', async () => {
    const withoutSubject = { ...claims() };
    delete withoutSubject.sub;

    const rejection = await rejectionOf(strategyFor(storeWith(ACCOUNT)).validate(withoutSubject));

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });

  it('lehnt einen Inhalt ab, der überhaupt kein Anspruchsobjekt ist', async () => {
    // Requirement 2.11 nennt das syntaktisch unlesbare Token als eigenen Fall.
    // `passport-jwt` gibt bei einem Token, dessen Nutzlast kein JSON-Objekt
    // ist, die Zeichenkette weiter; ohne diesen Zweig läse die Zuordnung `sub`
    // von einem Wert, der keine Ansprüche trägt.
    for (const payload of ['kein-objekt', null, 42]) {
      const rejection = await rejectionOf(strategyFor(storeWith(ACCOUNT)).validate(payload));

      expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    }
  });

  it('lehnt ein Token mit fremdem Aussteller auch ohne Optionsprüfung ab', async () => {
    // Die Zuordnung soll nicht davon abhängen, dass `issuer` in den Optionen
    // gesetzt ist: `validate` prüft `iss` selbst.
    const rejection = await rejectionOf(
      strategyFor(storeWith(ACCOUNT)).validate(claims({ iss: 'jemand-anderes' })),
    );

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });

  it('nennt weder Kontokennung noch Nachricht mit Innenleben nach außen', async () => {
    const rejection = await rejectionOf(
      strategyFor(storeWith(ACCOUNT)).validate(claims({ sub: 'geloeschtes-konto' })),
    );

    // Requirement 9.3: der Grund steht im Protokoll, nicht in der Antwort.
    expect(rejection.message).toBe('Das Access-Token ist ungültig.');
    expect(rejection.message).not.toContain('geloeschtes-konto');
  });

  it('meldet sich unter dem Namen an, den der Guard verlangt', () => {
    // `GqlAuthGuard` erbt von `AuthGuard(ACCESS_TOKEN_STRATEGY_NAME)`; ein
    // abweichender Name ließe den Guard ins Leere greifen.
    expect(strategyFor(storeWith(ACCOUNT)).name).toBe(ACCESS_TOKEN_STRATEGY_NAME);
  });
});
