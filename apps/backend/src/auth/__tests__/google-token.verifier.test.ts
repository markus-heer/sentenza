import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import * as fc from 'fast-check';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';

import { createLogger } from '../../common/logger.js';
import {
  GOOGLE_CLOCK_TOLERANCE_SECONDS,
  GoogleSigningKeyProvider,
  GoogleTokenVerifier,
  GoogleVerificationSettings,
  SigningKeyLookup,
} from '../google-token.verifier.js';

/**
 * Prüfung des Google-ID-Tokens (Aufgabe 6.1; Requirement 2.1, 2.2, 2.3, 2.13).
 *
 * Kein Netzzugriff (Requirement 10.9): Die Tokens entstehen aus einem hier
 * erzeugten RSA-Schlüsselpaar (`jose`), und der JWKS-Client ist durch eine
 * Attrappe ersetzt, die den öffentlichen Schlüssel aus dem Speicher liefert.
 * Kein Nest-Abhängigkeitsbaum: Die Klasse wird von Hand instanziiert.
 */

const SETTINGS: GoogleVerificationSettings = {
  clientId: 'sentenza-test-client.apps.googleusercontent.com',
  issuer: 'https://accounts.google.com',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  jwksTimeoutMs: 50,
};

const KEY_ID = 'google-key-1';
const OTHER_KEY_ID = 'google-key-2';

/** Aus `jose` abgeleitet, damit der Test keinen globalen Schlüsseltyp voraussetzt. */
type SigningPrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

interface KeyMaterial {
  privateKey: SigningPrivateKey;
  publicKeyPem: string;
}

async function createKeyMaterial(): Promise<KeyMaterial> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });

  return { privateKey, publicKeyPem: await exportSPKI(publicKey) };
}

/** Schlüsselpaar der erwarteten Signatur und ein zweites für Fremdsignaturen. */
let signing: KeyMaterial;
let foreign: KeyMaterial;

beforeAll(async () => {
  [signing, foreign] = await Promise.all([createKeyMaterial(), createKeyMaterial()]);
});

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

interface TokenOptions {
  claims?: Record<string, unknown>;
  /** Schlüsselkennung im Header; `null` lässt sie weg. */
  keyId?: string | null;
  signedWith?: KeyMaterial;
  /** Ablaufzeitpunkt in Sekunden relativ zu jetzt; `null` lässt `exp` weg. */
  expiresInSeconds?: number | null;
}

/** Erzeugt ein vollständig gültiges Token, sofern nichts abweichend gesetzt ist. */
async function signIdToken(options: TokenOptions = {}): Promise<string> {
  const { claims = {}, keyId = KEY_ID, signedWith = signing, expiresInSeconds = 3600 } = options;
  const issuedAt = nowInSeconds();
  const payload: Record<string, unknown> = {
    iss: SETTINGS.issuer,
    aud: SETTINGS.clientId,
    sub: '117482910284710294857',
    email: 'Nutzer@Example.com',
    email_verified: true,
    iat: issuedAt,
    ...(expiresInSeconds === null ? {} : { exp: issuedAt + expiresInSeconds }),
    ...claims,
  };

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', ...(keyId === null ? {} : { kid: keyId }) })
    .sign(signedWith.privateKey);
}

/** Attrappe des JWKS-Clients: liefert den Schlüssel ausschließlich aus dem Speicher. */
function keyProviderFor(lookup: (kid: string) => Promise<SigningKeyLookup>): {
  provider: GoogleSigningKeyProvider;
  requestedKeyIds: string[];
} {
  const requestedKeyIds: string[] = [];
  const provider: GoogleSigningKeyProvider = {
    getSigningKey: async (kid) => {
      requestedKeyIds.push(kid);
      return lookup(kid);
    },
  };

  return { provider, requestedKeyIds };
}

function verifierFor(provider: GoogleSigningKeyProvider): {
  verifier: GoogleTokenVerifier;
  lines: string[];
} {
  const lines: string[] = [];
  const logger = createLogger({
    component: 'auth',
    level: 'debug',
    sink: (line) => lines.push(line),
  });

  return { verifier: new GoogleTokenVerifier(SETTINGS, provider, logger), lines };
}

/** Der Normalfall: Der zur Schlüsselkennung passende Schlüssel liegt vor. */
function workingProvider(): { verifier: GoogleTokenVerifier; lines: string[] } {
  const { provider } = keyProviderFor(async (kid) =>
    kid === KEY_ID ? { found: true, publicKey: signing.publicKeyPem } : { found: false },
  );

  return verifierFor(provider);
}

async function expectRejection(
  verify: Promise<unknown>,
  code: SentenzaErrorCode,
): Promise<SentenzaError> {
  const error = await verify.then(
    () => undefined,
    (caught: unknown) => caught,
  );

  expect(error).toBeInstanceOf(SentenzaError);
  expect((error as SentenzaError).code).toBe(code);

  return error as SentenzaError;
}

function logEntries(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('GoogleTokenVerifier', () => {
  describe('nimmt ein vollständig gültiges Token an', () => {
    it('gibt Subject-Kennung und E-Mail-Adresse unverändert zurück', async () => {
      const { verifier, lines } = workingProvider();

      const identity = await verifier.verify(await signIdToken());

      expect(identity).toEqual({
        subject: '117482910284710294857',
        // Requirement 2.4: die Kleinschreibung entsteht erst beim Vergleich
        // gegen die Konto_Freigabeliste, nicht hier.
        email: 'Nutzer@Example.com',
        emailVerified: true,
      });
      expect(lines).toEqual([]);
    });

    it('wählt den Schlüssel anhand der Schlüsselkennung des Tokens', async () => {
      const { provider, requestedKeyIds } = keyProviderFor(async () => ({
        found: true,
        publicKey: signing.publicKeyPem,
      }));
      const { verifier } = verifierFor(provider);

      await verifier.verify(await signIdToken({ keyId: OTHER_KEY_ID }));

      expect(requestedKeyIds).toEqual([OTHER_KEY_ID]);
    });

    it('nimmt einen um weniger als 60 Sekunden überschrittenen Ablaufzeitpunkt an', async () => {
      const { verifier } = workingProvider();

      // Requirement 2.2: Toleranz von höchstens 60 Sekunden.
      const identity = await verifier.verify(await signIdToken({ expiresInSeconds: -30 }));

      expect(identity.subject).toBe('117482910284710294857');
    });
  });

  describe('lehnt jeden Tokendefekt mit UNAUTHENTICATED ab', () => {
    it('bei einem syntaktisch unlesbaren Token', async () => {
      const { verifier } = workingProvider();

      const error = await expectRejection(
        verifier.verify('kein.jwt'),
        SentenzaErrorCode.UNAUTHENTICATED,
      );

      expect(error.message).toBe('Das Google-ID-Token ist ungültig.');
    });

    it('bei leerer Zeichenkette', async () => {
      const { verifier } = workingProvider();

      await expectRejection(verifier.verify(''), SentenzaErrorCode.UNAUTHENTICATED);
    });

    it('bei fehlender Schlüsselkennung im Header', async () => {
      const { provider, requestedKeyIds } = keyProviderFor(async () => ({
        found: true,
        publicKey: signing.publicKeyPem,
      }));
      const { verifier } = verifierFor(provider);

      await expectRejection(
        verifier.verify(await signIdToken({ keyId: null })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
      // Ohne Schlüsselkennung findet kein Abruf statt.
      expect(requestedKeyIds).toEqual([]);
    });

    it('wenn kein passender Schlüssel in den JWKS vorliegt', async () => {
      const { provider } = keyProviderFor(async () => ({ found: false }));
      const { verifier } = verifierFor(provider);

      await expectRejection(
        verifier.verify(await signIdToken()),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('bei einer nicht verifizierbaren Signatur', async () => {
      const { verifier } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ signedWith: foreign })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('bei abweichendem `iss`', async () => {
      const { verifier } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ claims: { iss: 'https://evil.example.com' } })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('bei abweichendem `aud`', async () => {
      const { verifier } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ claims: { aud: 'fremde-client-kennung' } })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('bei erreichtem Ablaufzeitpunkt jenseits der Toleranz', async () => {
      const { verifier, lines } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ expiresInSeconds: -120 })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
      expect(logEntries(lines)[0]?.reason).toBe('expired');
    });

    it('bei fehlendem `exp`', async () => {
      const { verifier } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ expiresInSeconds: null })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('wenn `email_verified` nicht den Wahrheitswert `true` trägt', async () => {
      const { verifier, lines } = workingProvider();

      for (const emailVerified of [false, 'true', undefined]) {
        await expectRejection(
          verifier.verify(await signIdToken({ claims: { email_verified: emailVerified } })),
          SentenzaErrorCode.UNAUTHENTICATED,
        );
      }

      expect(logEntries(lines).map((entry) => entry.reason)).toEqual([
        'email-unverified',
        'email-unverified',
        'email-unverified',
      ]);
    });

    it('bei fehlender Subject-Kennung oder fehlender E-Mail-Adresse', async () => {
      const { verifier } = workingProvider();

      await expectRejection(
        verifier.verify(await signIdToken({ claims: { sub: undefined } })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
      await expectRejection(
        verifier.verify(await signIdToken({ claims: { email: '   ' } })),
        SentenzaErrorCode.UNAUTHENTICATED,
      );
    });

    it('protokolliert den Grund, aber niemals das Token selbst', async () => {
      const { verifier, lines } = workingProvider();
      const idToken = await signIdToken({ signedWith: foreign });

      await expectRejection(verifier.verify(idToken), SentenzaErrorCode.UNAUTHENTICATED);

      const [entry] = logEntries(lines);
      expect(entry?.level).toBe('warn');
      expect(entry?.component).toBe('auth');
      expect(entry?.step).toBe('auth.google.verify');
      expect(entry?.reason).toBe('signature');
      // Requirement 9.5: kein Token in einem Protokolleintrag.
      expect(lines.join('\n')).not.toContain(idToken);
    });
  });

  describe('lehnt nicht abrufbare JWKS mit UPSTREAM_UNAVAILABLE ab', () => {
    it('wenn die JWKS nicht innerhalb des Zeitlimits antworten', async () => {
      // Requirement 2.13: Abbruch nach der konfigurierten Frist (hier 50 ms
      // statt 5 Sekunden), ausdrücklich nicht als UNAUTHENTICATED.
      const { provider } = keyProviderFor(() => new Promise<never>(() => undefined));
      const { verifier, lines } = verifierFor(provider);

      const error = await expectRejection(
        verifier.verify(await signIdToken()),
        SentenzaErrorCode.UPSTREAM_UNAVAILABLE,
      );

      expect(error.message).toBe(
        'Die Signaturprüfung des Google-ID-Tokens ist vorübergehend nicht möglich.',
      );
      const [entry] = logEntries(lines);
      expect(entry?.step).toBe('auth.google.jwks');
      expect(entry?.reason).toBe('timeout');
      expect(entry?.timeoutMs).toBe(SETTINGS.jwksTimeoutMs);
    });

    it('wenn der Abruf der JWKS mit einem Netzfehler fehlschlägt', async () => {
      const { provider } = keyProviderFor(async () => {
        throw new Error('getaddrinfo ENOTFOUND www.googleapis.com');
      });
      const { verifier, lines } = verifierFor(provider);

      await expectRejection(
        verifier.verify(await signIdToken()),
        SentenzaErrorCode.UPSTREAM_UNAVAILABLE,
      );

      const [entry] = logEntries(lines);
      expect(entry?.reason).toBe('unreachable');
      expect(entry?.cause).toContain('ENOTFOUND');
    });
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 24: Ein Google-ID-Token wird
 * genau bei vollständiger Gültigkeit angenommen.
 *
 * **Validates: Requirements 2.1, 2.2, 2.3**
 *
 * Geprüft wird die Tokenprüfung als reine Funktion über einer breiten Menge
 * erzeugter Tokens. Weil die Aussage eine Äquivalenz ist („genau dann“),
 * erreicht der Generator beide Richtungen: vollständig gültige Tokens — auch
 * solche mit einem Ablaufzeitpunkt innerhalb der Toleranz von 60 Sekunden —
 * und Tokens mit je genau einer erzeugten Abweichung: unlesbare Zeichenketten,
 * fehlende und unbekannte Schlüsselkennung, Signatur eines fremden Schlüssels,
 * nachträglich verändertes Payload, abweichendes `iss`, abweichendes `aud`,
 * Ablaufzeitpunkt jenseits der Toleranz, fehlendes `exp`, nicht bestätigte
 * E-Mail-Adresse sowie fehlende Ansprüche `sub` und `email`.
 *
 * Kein Netzzugriff (Requirement 10.9): Jeder Durchlauf signiert mit dem im
 * Test erzeugten RSA-Schlüsselpaar und erhält den öffentlichen Schlüssel aus
 * der JWKS-Attrappe im Speicher. Kein Nest-Abhängigkeitsbaum: Die Klasse wird
 * von Hand instanziiert.
 *
 * Die Zusagen „kein Sentenza_Access_Token und kein Sentenza_Refresh_Token“ und
 * „kein Benutzerkonto angelegt oder geändert“ sind hier strukturell erfüllt:
 * `GoogleTokenVerifier` kennt als einzigen Mitspieler den Schlüssellieferanten
 * und weder Tokenausstellung noch Prisma. Der Test hält das fest, indem er je
 * Durchlauf die vollständige Liste der Aufrufe an diesem Mitspieler prüft;
 * Ausstellung und Kontoanlage liegen in `AuthService` (Property 26, 27).
 */

/**
 * Genau eine Abweichung je Token. `none` und `expired-within-tolerance` sind
 * keine Defekte: Ein um weniger als 60 Sekunden überschrittener
 * Ablaufzeitpunkt liegt nach Requirement 2.2 noch innerhalb der Toleranz.
 */
type Deviation =
  | 'none'
  | 'expired-within-tolerance'
  | 'unreadable'
  | 'missing-key-id'
  | 'unknown-key-id'
  | 'foreign-signature'
  | 'tampered-payload'
  | 'wrong-issuer'
  | 'wrong-audience'
  | 'expired-beyond-tolerance'
  | 'missing-exp'
  | 'email-unverified'
  | 'missing-subject'
  | 'missing-email';

const DEVIATIONS: readonly Deviation[] = [
  'none',
  'expired-within-tolerance',
  'unreadable',
  'missing-key-id',
  'unknown-key-id',
  'foreign-signature',
  'tampered-payload',
  'wrong-issuer',
  'wrong-audience',
  'expired-beyond-tolerance',
  'missing-exp',
  'email-unverified',
  'missing-subject',
  'missing-email',
];

/** Die beiden Lagen, in denen ein Token vollständig gültig ist. */
const ACCEPTED_DEVIATIONS = new Set<Deviation>(['none', 'expired-within-tolerance']);

/**
 * Abstand zur Toleranzgrenze in Sekunden. Der Generator meidet die Grenze
 * selbst von beiden Seiten: Zwischen dem Signieren und der Prüfung verstreicht
 * Zeit, und ein auf die Sekunde genau gesetzter Ablaufzeitpunkt würde den Test
 * von dieser Laufzeit abhängig machen.
 */
const TOLERANCE_MARGIN_SECONDS = 15;

/**
 * Segment einer unlesbaren Zeichenkette: base64url eines Textes, der
 * ausdrücklich kein JSON ist. Damit scheitert das Lesen des Headers
 * zuverlässig und nicht zufällig.
 */
const garbageSegmentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((value) => Buffer.from(`nicht-json-${value}`, 'utf8').toString('base64url'));

/** Zeichenketten, die kein lesbares JWT sind (Requirement 2.3: syntaktisch unlesbar). */
const unreadableTokenArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(''),
  fc.constant('kein.jwt'),
  fc.constant('...'),
  fc.constant('eyJhbGciOiJSUzI1NiJ9'),
  fc.string({ minLength: 1, maxLength: 40 }).map((value) => value.replaceAll('.', '-')),
  fc
    .tuple(garbageSegmentArb, garbageSegmentArb, garbageSegmentArb)
    .map(([header, payload, signature]) => `${header}.${payload}.${signature}`),
);

/** Ansprüche, wie Google sie stellt: Subject-Kennung aus Ziffern, E-Mail in wechselnder Schreibweise. */
const subjectArb: fc.Arbitrary<string> = fc
  .integer({ min: 100_000_000, max: 999_999_999 })
  .map((value) => `11748291028${value}`);

const emailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('nutzer', 'Maria.Lopez', 'lerner+busuu', 'MARKUS'),
    fc.constantFrom('example.com', 'Example.COM', 'gmail.com'),
  )
  .map(([local, domain]) => `${local}@${domain}`);

/** Ein erzeugter Ablauf: die Abweichung und alle Werte, die sie braucht. */
interface Scenario {
  readonly deviation: Deviation;
  readonly subject: string;
  readonly email: string;
  /** Gültigkeitsdauer des unbeanstandeten Tokens in Sekunden. */
  readonly lifetimeSeconds: number;
  /** Überschreitung des Ablaufzeitpunkts innerhalb der Toleranz. */
  readonly withinToleranceSeconds: number;
  /** Überschreitung des Ablaufzeitpunkts jenseits der Toleranz. */
  readonly beyondToleranceSeconds: number;
  readonly unreadableToken: string;
  readonly unknownKeyId: string;
  readonly foreignIssuer: string;
  readonly foreignAudience: string;
  /** Wert von `email_verified`, der den Wahrheitswert `true` gerade nicht trägt. */
  readonly unverifiedValue: unknown;
  /** Wert eines fehlenden Anspruchs: abwesend, leer oder nur Leerzeichen. */
  readonly absentClaimValue: string | undefined;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  deviation: fc.constantFrom(...DEVIATIONS),
  subject: subjectArb,
  email: emailArb,
  lifetimeSeconds: fc.integer({ min: 60, max: 3_600 }),
  withinToleranceSeconds: fc.integer({
    min: 1,
    max: GOOGLE_CLOCK_TOLERANCE_SECONDS - TOLERANCE_MARGIN_SECONDS,
  }),
  beyondToleranceSeconds: fc.integer({
    min: GOOGLE_CLOCK_TOLERANCE_SECONDS + TOLERANCE_MARGIN_SECONDS,
    max: 30 * 24 * 3_600,
  }),
  unreadableToken: unreadableTokenArb,
  unknownKeyId: fc
    .string({ minLength: 1, maxLength: 20 })
    .filter((value) => value.trim().length > 0 && value !== KEY_ID),
  foreignIssuer: fc.constantFrom(
    'accounts.google.com',
    'https://accounts.google.com.evil.example',
    'https://login.microsoftonline.com',
    'sentenza',
  ),
  foreignAudience: fc.constantFrom(
    'fremde-client-kennung.apps.googleusercontent.com',
    'sentenza-test-client.apps.googleusercontent.com.evil.example',
    '',
  ),
  unverifiedValue: fc.constantFrom<unknown>(false, 'true', 'false', undefined, null, 0, 1),
  absentClaimValue: fc.constantFrom<string | undefined>(undefined, '', '   ', '\t'),
});

/**
 * Ersetzt das Payload-Segment eines gültig signierten Tokens durch ein
 * abweichendes. Header und Signatur bleiben unberührt, die Signatur deckt den
 * neuen Inhalt also nicht mehr.
 */
function tamperPayload(idToken: string): string {
  const [header, payload, signature] = idToken.split('.');
  const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const tampered = Buffer.from(
    JSON.stringify({ ...claims, sub: `${String(claims.sub)}-manipuliert` }),
    'utf8',
  ).toString('base64url');

  return `${header}.${tampered}.${signature}`;
}

/**
 * Baut das Token des Ablaufs und benennt die Schlüsselkennung, nach der die
 * Prüfung fragen muss. `undefined` heißt: Es darf überhaupt kein Abruf
 * stattfinden, weil schon der Header keine Schlüsselkennung liefert.
 */
async function buildScenarioToken(
  scenario: Scenario,
): Promise<{ idToken: string; requestedKeyId: string | undefined }> {
  const identityClaims = { sub: scenario.subject, email: scenario.email };
  const valid = {
    claims: identityClaims,
    expiresInSeconds: scenario.lifetimeSeconds,
  } as const;

  switch (scenario.deviation) {
    case 'none':
      return { idToken: await signIdToken(valid), requestedKeyId: KEY_ID };

    case 'expired-within-tolerance':
      return {
        idToken: await signIdToken({
          ...valid,
          expiresInSeconds: -scenario.withinToleranceSeconds,
        }),
        requestedKeyId: KEY_ID,
      };

    case 'unreadable':
      return { idToken: scenario.unreadableToken, requestedKeyId: undefined };

    case 'missing-key-id':
      return { idToken: await signIdToken({ ...valid, keyId: null }), requestedKeyId: undefined };

    case 'unknown-key-id':
      return {
        idToken: await signIdToken({ ...valid, keyId: scenario.unknownKeyId }),
        requestedKeyId: scenario.unknownKeyId,
      };

    case 'foreign-signature':
      return {
        idToken: await signIdToken({ ...valid, signedWith: foreign }),
        requestedKeyId: KEY_ID,
      };

    case 'tampered-payload':
      return { idToken: tamperPayload(await signIdToken(valid)), requestedKeyId: KEY_ID };

    case 'wrong-issuer':
      return {
        idToken: await signIdToken({
          ...valid,
          claims: { ...identityClaims, iss: scenario.foreignIssuer },
        }),
        requestedKeyId: KEY_ID,
      };

    case 'wrong-audience':
      return {
        idToken: await signIdToken({
          ...valid,
          claims: { ...identityClaims, aud: scenario.foreignAudience },
        }),
        requestedKeyId: KEY_ID,
      };

    case 'expired-beyond-tolerance':
      return {
        idToken: await signIdToken({
          ...valid,
          expiresInSeconds: -scenario.beyondToleranceSeconds,
        }),
        requestedKeyId: KEY_ID,
      };

    case 'missing-exp':
      return {
        idToken: await signIdToken({ ...valid, expiresInSeconds: null }),
        requestedKeyId: KEY_ID,
      };

    case 'email-unverified':
      return {
        idToken: await signIdToken({
          ...valid,
          claims: { ...identityClaims, email_verified: scenario.unverifiedValue },
        }),
        requestedKeyId: KEY_ID,
      };

    case 'missing-subject':
      return {
        idToken: await signIdToken({
          ...valid,
          claims: { ...identityClaims, sub: scenario.absentClaimValue },
        }),
        requestedKeyId: KEY_ID,
      };

    case 'missing-email':
      return {
        idToken: await signIdToken({
          ...valid,
          claims: { ...identityClaims, email: scenario.absentClaimValue },
        }),
        requestedKeyId: KEY_ID,
      };
  }
}

describe('GoogleTokenVerifier (Property 24)', () => {
  it('nimmt ein Google-ID-Token genau dann an, wenn Signatur, Schlüsselkennung, iss, aud, exp und email_verified vollständig stimmen', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        // Die JWKS-Attrappe kennt genau einen Schlüssel; jede andere
        // Schlüsselkennung ist ein Ergebnis „nicht gefunden“ und kein Fehler,
        // damit UPSTREAM_UNAVAILABLE in diesem Test nicht vorkommen kann.
        const { provider, requestedKeyIds } = keyProviderFor(async (kid) =>
          kid === KEY_ID ? { found: true, publicKey: signing.publicKeyPem } : { found: false },
        );
        const { verifier } = verifierFor(provider);
        const { idToken, requestedKeyId } = await buildScenarioToken(scenario);

        if (ACCEPTED_DEVIATIONS.has(scenario.deviation)) {
          // Richtung 1: vollständige Gültigkeit ergibt die bezeugte Identität,
          // mit unveränderter E-Mail-Adresse (die Kleinschreibung entsteht erst
          // beim Vergleich gegen die Konto_Freigabeliste, Requirement 2.4).
          const identity = await verifier.verify(idToken);

          expect(identity).toEqual({
            subject: scenario.subject,
            email: scenario.email,
            emailVerified: true,
          });
        } else {
          // Richtung 2: jede einzelne Abweichung ergibt UNAUTHENTICATED,
          // niemals eine Identität und niemals einen anderen Fehlercode
          // (Requirement 2.3).
          const error = await expectRejection(
            verifier.verify(idToken),
            SentenzaErrorCode.UNAUTHENTICATED,
          );

          expect(error.message).toBe('Das Google-ID-Token ist ungültig.');
        }

        // Requirement 2.1: Der Schlüssel wird anhand der Schlüsselkennung des
        // Tokens ausgewählt — genau ein Abruf mit genau dieser Kennung, und
        // ohne Schlüsselkennung im Header überhaupt keiner. Zugleich ist dies
        // die vollständige Liste der Aufrufe an Mitspielern: Es gibt weder eine
        // Tokenausstellung noch einen Schreibzugriff, der stattfinden könnte.
        expect(requestedKeyIds).toEqual(requestedKeyId === undefined ? [] : [requestedKeyId]);
      }),
      { numRuns: 100 },
    );
  });
});
