import { createHash } from 'node:crypto';

import { decode as decodeJwt, verify as verifyJwt } from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_ISSUER,
  REFRESH_TOKEN_BYTES,
  TokenIssuer,
  type TokenIssuerSettings,
} from '../token-issuer.js';

/**
 * Ausstellung der Sentenza-Tokens (Aufgabe 6.5; Requirement 2.5, 2.6).
 *
 * Kein Nest-Abhängigkeitsbaum, keine Datenbank, kein Netzzugriff: Die Klasse
 * kennt als Mitspieler allein die übergebene Zeit- und Zufallsquelle. Die
 * Ausstellung wird an ihrem Ergebnis geprüft — das Access-Token gegen dasselbe
 * Geheimnis verifiziert, wie es `JwtStrategy` später tut (Aufgabe 6.10), das
 * Refresh-Token gegen den unabhängig im Test berechneten Hash.
 *
 * Der eigenschaftsbasierte Test zu Property 26 prüft die Gültigkeitsdauern an
 * der Antwort von Auth_Service und gehört deshalb in dessen Testdatei
 * (Aufgabe 6.6).
 */

const SETTINGS: TokenIssuerSettings = {
  jwtSecret: 'geheim-fuer-den-test-0123456789',
  accessTokenTtlMinutes: 15,
  refreshTokenTtlDays: 30,
};

/** Fester Zeitpunkt, bewusst nicht auf einer Sekundengrenze. */
const NOW = new Date('2026-03-01T10:20:30.750Z');

/** Derselbe Zeitpunkt als Sekunden seit der Epoche, für `clockTimestamp` bei der Prüfung. */
const NOW_SECONDS = Math.floor(NOW.getTime() / 1_000);

function issuerAt(now: Date, settings: TokenIssuerSettings = SETTINGS): TokenIssuer {
  return new TokenIssuer(settings, () => now);
}

describe('TokenIssuer.issueAccessToken', () => {
  it('stellt ein gegen das konfigurierte Geheimnis prüfbares HS256-Token aus', () => {
    const issued = issuerAt(NOW).issueAccessToken('konto-1');

    // Requirement 2.10: das Token muss prüfbar sein. Verifiziert wird hier wie
    // in `JwtStrategy`: dasselbe Geheimnis, nur HS256 zugelassen. `clockTimestamp`
    // stellt die Prüfung auf denselben festen Zeitpunkt wie die Ausstellung,
    // damit der Test nicht von der Uhr des ausführenden Rechners abhängt.
    const payload = verifyJwt(issued.token, SETTINGS.jwtSecret, {
      algorithms: [ACCESS_TOKEN_ALGORITHM],
      issuer: ACCESS_TOKEN_ISSUER,
      clockTimestamp: NOW_SECONDS,
    });

    expect(typeof payload).toBe('object');
    expect(payload).toMatchObject({ sub: 'konto-1', iss: 'sentenza' });
    expect(decodeJwt(issued.token, { complete: true })?.header.alg).toBe('HS256');
  });

  it('setzt exp auf die konfigurierte Gültigkeitsdauer und meldet denselben Ablaufzeitpunkt', () => {
    const issued = issuerAt(NOW).issueAccessToken('konto-1');
    const claims = decodeJwt(issued.token) as { iat: number; exp: number };

    // Requirement 2.6: Gültigkeitsdauer aus der Konfiguration.
    expect(claims.exp - claims.iat).toBe(SETTINGS.accessTokenTtlMinutes * 60);
    // Requirement 2.5: der zurückgegebene Ablaufzeitpunkt ist genau der
    // Anspruch im Token, nicht eine zweite, danebenlaufende Rechnung.
    expect(issued.expiresAt.getTime()).toBe(claims.exp * 1_000);
    expect(claims.iat).toBe(Math.floor(NOW.getTime() / 1_000));
  });

  it('übernimmt eine abweichend konfigurierte Gültigkeitsdauer', () => {
    const issued = issuerAt(NOW, { ...SETTINGS, accessTokenTtlMinutes: 5 }).issueAccessToken(
      'konto-1',
    );
    const claims = decodeJwt(issued.token) as { iat: number; exp: number };

    expect(claims.exp - claims.iat).toBe(5 * 60);
  });

  it('weist ein mit einem anderen Geheimnis geprüftes Token ab', () => {
    const issued = issuerAt(NOW).issueAccessToken('konto-1');

    // Die Fehlerbedingung dieser Funktion liegt nicht in ihr, sondern in der
    // späteren Prüfung: Ohne das Geheimnis ist das Token nicht verwendbar.
    expect(() =>
      verifyJwt(issued.token, 'ein-anderes-geheimnis', {
        algorithms: [ACCESS_TOKEN_ALGORITHM],
        clockTimestamp: NOW_SECONDS,
      }),
    ).toThrow(/invalid signature/);
  });
});

describe('TokenIssuer.issueRefreshToken', () => {
  it('stellt ein opakes Zufallstoken aus 32 Byte in base64url aus', () => {
    const issued = issuerAt(NOW).issueRefreshToken();

    // base64url ohne Auffüllzeichen: 32 Byte ergeben 43 Zeichen.
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(issued.token, 'base64url')).toHaveLength(REFRESH_TOKEN_BYTES);
    // Kein JWT, also auch kein lesbarer Inhalt (design.md, "Refresh-Token und Widerruf").
    expect(issued.token).not.toContain('.');
  });

  it('speichert ausschließlich den SHA-256-Hash und setzt den Ablauf auf 30 Tage', () => {
    const issued = issuerAt(NOW).issueRefreshToken();

    expect(issued.tokenHash).toBe(createHash('sha256').update(issued.token, 'utf8').digest('hex'));
    expect(issued.tokenHash).not.toBe(issued.token);
    // Requirement 2.5: 30 Tage, hier über die Vorgabe aus der Konfiguration.
    expect(issued.expiresAt.getTime() - NOW.getTime()).toBe(30 * 24 * 60 * 60 * 1_000);
  });

  it('stellt bei jedem Aufruf ein anderes Token aus', () => {
    const issuer = issuerAt(NOW);
    const tokens = new Set(
      Array.from({ length: 50 }, () => issuer.issueRefreshToken()).map((issued) => issued.token),
    );

    // Zwei gleiche Tokens wären zwei Clients mit derselben Anmeldung; die
    // eindeutige Spalte `tokenHash` würde die zweite Ablage zudem abweisen.
    expect(tokens.size).toBe(50);
  });
});

describe('TokenIssuer.hashRefreshToken', () => {
  it('bildet ein vorgelegtes Token auf die gespeicherte Form ab', () => {
    const issuer = issuerAt(NOW);
    const issued = issuer.issueRefreshToken();

    // Aufgabe 6.8 findet den Datensatz über genau diesen Weg.
    expect(issuer.hashRefreshToken(issued.token)).toBe(issued.tokenHash);
  });

  it('liefert für ein nie ausgestelltes Token einen anderen Hash', () => {
    const issuer = issuerAt(NOW);
    const issued = issuer.issueRefreshToken();

    // Requirement 2.14: kein Datensatz zum Hash bedeutet "nicht von
    // Auth_Service ausgestellt". Das setzt voraus, dass ein fremdes Token
    // nicht denselben Hash trifft, auch nicht bei minimaler Abweichung.
    expect(issuer.hashRefreshToken(`${issued.token}x`)).not.toBe(issued.tokenHash);
    expect(issuer.hashRefreshToken('')).not.toBe(issued.tokenHash);
  });

  it('ist für dieselbe Eingabe stabil und unabhängig von der Zeitquelle', () => {
    const early = issuerAt(new Date('2026-01-01T00:00:00.000Z'));
    const late = issuerAt(new Date('2027-01-01T00:00:00.000Z'));

    expect(early.hashRefreshToken('ein-token')).toBe(late.hashRefreshToken('ein-token'));
  });
});
