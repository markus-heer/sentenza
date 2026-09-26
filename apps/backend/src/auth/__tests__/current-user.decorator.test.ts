import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import type {
  AuthenticatedAccount,
  AuthenticatedGraphQLContext,
} from '../authenticated-account.js';
import { currentUserFromContext } from '../current-user.decorator.js';

/**
 * Tests für `@CurrentUser()` (Requirement 2.10, 2.12).
 *
 * Geprüft wird `currentUserFromContext`, die Funktion hinter dem Dekorator: Ein
 * Parameter-Dekorator ist von außen nicht aufrufbar, und ein Nest-Container
 * kommt nach der Konvention des Backends nicht zum Einsatz. Der
 * `ExecutionContext` ist ein Double in der Form, die
 * `GqlExecutionContext.create` erwartet — vier Argumente eines Feldresolvers
 * mit dem Kontext an Position 2.
 */

const ACCOUNT: AuthenticatedAccount = { id: 'konto-1', email: 'lernende@example.com' };

function contextFor(graphqlContext: AuthenticatedGraphQLContext): ExecutionContext {
  return {
    getType: () => 'graphql',
    getArgs: () => [undefined, {}, graphqlContext, undefined],
    getClass: () => class {},
    getHandler: () => () => undefined,
  } as unknown as ExecutionContext;
}

/** Nimmt einen erwarteten `SentenzaError` ab und gibt ihn zur weiteren Prüfung zurück. */
function rejectionOf(operation: () => unknown): SentenzaError {
  try {
    operation();
  } catch (error) {
    if (error instanceof SentenzaError) {
      return error;
    }

    expect.fail(`Erwartet war ein SentenzaError, beobachtet wurde: ${String(error)}`);
  }

  return expect.fail('Erwartet war eine Ablehnung, der Aufruf ging jedoch durch.');
}

describe('@CurrentUser()', () => {
  it('liefert das vom Guard bereitgestellte Konto', () => {
    // Genau die Stelle, an die `GqlAuthGuard.canActivate` das Konto legt.
    expect(currentUserFromContext(contextFor({ user: ACCOUNT }))).toEqual(ACCOUNT);
  });

  it('lehnt ab, wenn kein Konto im Kontext liegt', () => {
    const rejection = rejectionOf(() => currentUserFromContext(contextFor({})));

    // Requirement 2.12: ohne Konto darf kein Service-Verfahren weiterlaufen —
    // es hätte keine Kennung, auf die es seine Abfrage einschränken könnte.
    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });

  it('liest das Konto nicht aus der Anfrage, wenn der Guard es nicht bereitgestellt hat', () => {
    // Eine Anfrage mit `user` ohne den Schritt des Guards kommt im Betrieb nicht
    // vor. Dass sie hier nicht genügt, hält die Quelle des Kontos eindeutig:
    // Es gibt genau eine, und das ist der Kontext.
    const rejection = rejectionOf(() =>
      currentUserFromContext(contextFor({ req: { user: ACCOUNT } })),
    );

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });

  it('nennt in der Antwort keinen Grund mit Innenleben', () => {
    // Requirement 9.3: nach außen ist ein fehlgeleiteter Resolver nicht von
    // einem fehlenden Token zu unterscheiden.
    expect(rejectionOf(() => currentUserFromContext(contextFor({}))).message).toBe(
      'Für diese Operation ist eine Anmeldung erforderlich.',
    );
  });
});
