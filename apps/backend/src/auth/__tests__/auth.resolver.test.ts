import 'reflect-metadata';

import { RESOLVER_TYPE_METADATA } from '@nestjs/graphql';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import { AuthResolver, type AuthResolverService } from '../auth.resolver.js';
import { AccessTokenPayload } from '../models/access-token-payload.model.js';
import { AuthPayload } from '../models/auth-payload.model.js';
import { IS_PUBLIC_KEY } from '../public.decorator.js';

/**
 * Tests für `AuthResolver` (Requirement 2.5, 2.9, 9.2).
 *
 * Kein Nest-Container: Der Resolver wird von Hand instanziiert, Auth_Service
 * ist eine Attrappe, die mitschreibt, womit sie aufgerufen wurde. Damit ist
 * genau das prüfbar, was dieser Resolver selbst zu verantworten hat — welches
 * Feld der Eingabe an welches Verfahren geht, dass das Ergebnis unverändert
 * durchgeht und dass eine Ablehnung des Service nicht unterwegs verändert wird.
 *
 * Dass beide Felder als Mutationen im erzeugten Schema stehen und ausgenommen
 * sind, prüft zusätzlich Property 29 in `gql-auth.guard.test.ts` gegen
 * `schema.gql`; hier werden die Metadaten unmittelbar an der Klasse gelesen.
 */

const SIGN_IN_RESULT: AuthPayload = {
  accessToken: 'access-token-der-anmeldung',
  accessTokenExpiresAt: new Date('2026-01-01T12:15:00.000Z'),
  refreshToken: 'refresh-token-der-anmeldung',
  refreshTokenExpiresAt: new Date('2026-01-31T12:00:00.000Z'),
};

const REFRESH_RESULT: AccessTokenPayload = {
  accessToken: 'access-token-der-erneuerung',
  accessTokenExpiresAt: new Date('2026-01-01T12:30:00.000Z'),
};

/** Was die Attrappe entgegengenommen hat: die reine Zeichenkette, kein Objekt. */
interface RecordedCalls {
  signIn: string[];
  refresh: string[];
}

/**
 * Auth_Service als Attrappe. Sie erfüllt `AuthResolverService` und damit genau
 * die zwei Verfahren, die der Resolver aufruft — der Rest der Klasse samt
 * Google-Prüfung, Datenbank und Tokenausstellung bleibt aus dem Spiel.
 */
function resolverWith(
  behaviour: Partial<{
    signIn: () => Promise<AuthPayload>;
    refresh: () => Promise<AccessTokenPayload>;
  }> = {},
): { resolver: AuthResolver; calls: RecordedCalls } {
  const calls: RecordedCalls = { signIn: [], refresh: [] };

  const service: AuthResolverService = {
    signInWithGoogle: async (idToken) => {
      calls.signIn.push(idToken);
      return behaviour.signIn === undefined ? SIGN_IN_RESULT : behaviour.signIn();
    },
    refreshAccessToken: async (refreshToken) => {
      calls.refresh.push(refreshToken);
      return behaviour.refresh === undefined ? REFRESH_RESULT : behaviour.refresh();
    },
  };

  return { resolver: new AuthResolver(service), calls };
}

describe('signInWithGoogle', () => {
  it('übergibt das Google-ID-Token an Auth_Service und gibt beide Tokens samt Ablaufzeitpunkten zurück', async () => {
    const { resolver, calls } = resolverWith();

    const payload = await resolver.signInWithGoogle({ idToken: 'google-id-token' });

    // Requirement 2.5: beide Tokens und beide Ablaufzeitpunkte in derselben
    // Antwort, unverändert wie vom Service geliefert.
    expect(payload).toEqual(SIGN_IN_RESULT);
    expect(calls.signIn).toEqual(['google-id-token']);
    expect(calls.refresh).toEqual([]);
  });

  it('reicht die Ablehnung von Auth_Service unverändert weiter', async () => {
    const rejection = new SentenzaError(
      SentenzaErrorCode.UNAUTHENTICATED,
      'Das Google-ID-Token ist ungültig.',
    );
    const { resolver } = resolverWith({ signIn: () => Promise.reject(rejection) });

    // Der Resolver fängt nichts ab: Fehlercode und Nachricht entstehen im
    // Service, `formatError` bildet sie auf die Antwort ab (Requirement 9.1).
    await expect(resolver.signInWithGoogle({ idToken: 'kaputt' })).rejects.toBe(rejection);
  });
});

describe('refreshAccessToken', () => {
  it('übergibt das Refresh-Token an Auth_Service und gibt nur das neue Access-Token zurück', async () => {
    const { resolver, calls } = resolverWith();

    const payload = await resolver.refreshAccessToken({ refreshToken: 'refresh-token' });

    // Requirement 2.9: ein neues Access-Token samt Ablaufzeitpunkt, kein
    // Refresh-Token — es gibt keine Rotation.
    expect(payload).toEqual(REFRESH_RESULT);
    expect(Object.keys(payload).sort()).toEqual(['accessToken', 'accessTokenExpiresAt']);
    expect(calls.refresh).toEqual(['refresh-token']);
    expect(calls.signIn).toEqual([]);
  });

  it('reicht die Ablehnung eines nicht vorlagefähigen Refresh-Tokens unverändert weiter', async () => {
    const rejection = new SentenzaError(
      SentenzaErrorCode.UNAUTHENTICATED,
      'Das Refresh-Token ist ungültig.',
    );
    const { resolver } = resolverWith({ refresh: () => Promise.reject(rejection) });

    // Requirement 2.14: die vier Ablehnungsgründe entscheidet der Service; der
    // Resolver macht daraus keinen eigenen Fehler.
    await expect(resolver.refreshAccessToken({ refreshToken: 'widerrufen' })).rejects.toBe(
      rejection,
    );
  });
});

describe('Schnitt der Felder', () => {
  it('trägt an beiden Feldern @Public()', () => {
    // Requirement 2.10 nimmt genau Anmeldung und Erneuerung aus; ohne den
    // Dekorator wäre keine Anmeldung möglich, weil der global registrierte
    // `GqlAuthGuard` ein Access-Token verlangte, das erst hier entsteht.
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AuthResolver.prototype.signInWithGoogle) as unknown,
    ).toBe(true);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, AuthResolver.prototype.refreshAccessToken) as unknown,
    ).toBe(true);
  });

  it('erklärt beide Felder als Mutation und hat kein weiteres Feld', () => {
    const fields = Object.getOwnPropertyNames(AuthResolver.prototype).filter(
      (name) =>
        Reflect.getMetadata(
          RESOLVER_TYPE_METADATA,
          Object.getOwnPropertyDescriptor(AuthResolver.prototype, name)?.value,
        ) === 'Mutation',
    );

    // Eine dritte Ausnahme vom Anmeldezwang darf hier nicht unbemerkt
    // entstehen: Jedes weitere Feld dieses Resolvers wäre eine.
    expect(fields.sort()).toEqual(['refreshAccessToken', 'signInWithGoogle']);
  });

  it('nimmt an keinem Feld eine Konto-Kennung entgegen', () => {
    // Requirement 2.12: Die Konto-Kennung kommt ausschließlich aus
    // `@CurrentUser()`. Beide Felder haben genau ein Argument — die Eingabe —,
    // und deren Felder sind allein die vorgelegten Tokens.
    expect(AuthResolver.prototype.signInWithGoogle).toHaveLength(1);
    expect(AuthResolver.prototype.refreshAccessToken).toHaveLength(1);
  });
});
