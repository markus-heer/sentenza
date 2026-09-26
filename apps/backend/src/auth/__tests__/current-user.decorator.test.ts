import 'reflect-metadata';

import type { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import type {
  AuthenticatedAccount,
  AuthenticatedGraphQLContext,
} from '../authenticated-account.js';
import { CurrentUser, currentUserFromContext } from '../current-user.decorator.js';

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

/**
 * Der Dekorator selbst (Requirement 10.3).
 *
 * Die Tests oben prüfen `currentUserFromContext`. Dass der von `@CurrentUser()`
 * hinterlegte Parameter tatsächlich zu dieser Funktion führt, sagen sie nicht —
 * ein Dekorator, der am Parameter nichts oder etwas anderes hinterlegte, käme
 * durch. Geprüft wird deshalb die Fabrik, die Nest beim Auflösen des Parameters
 * aufruft: Sie steht in den Metadaten des dekorierten Feldes und ist von außen
 * aufrufbar, ohne dass ein Nest-Container laufen muss.
 */
describe('@CurrentUser() am Parameter eines Feldes', () => {
  class ResolverDouble {
    grammarTopics(@CurrentUser() account: AuthenticatedAccount): AuthenticatedAccount {
      return account;
    }
  }

  /** Die Fabrik, die Nest für den dekorierten Parameter aufruft. */
  function parameterFactory(): (data: unknown, context: ExecutionContext) => unknown {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, ResolverDouble, 'grammarTopics') as
      | Record<string, { factory?: (data: unknown, context: ExecutionContext) => unknown }>
      | undefined;
    const factories = Object.values(metadata ?? {})
      .map((entry) => entry.factory)
      .filter((factory): factory is (data: unknown, context: ExecutionContext) => unknown => {
        return typeof factory === 'function';
      });

    // Genau ein dekorierter Parameter, genau eine Fabrik.
    expect(factories).toHaveLength(1);

    return factories[0] as (data: unknown, context: ExecutionContext) => unknown;
  }

  it('liefert dem Feld das vom Guard bereitgestellte Konto', () => {
    expect(parameterFactory()(undefined, contextFor({ user: ACCOUNT }))).toEqual(ACCOUNT);
  });

  it('lehnt ab, wenn kein Konto im Kontext liegt', () => {
    // Requirement 2.12: Der dekorierte Parameter ist der einzige Weg, auf dem
    // eine Konto-Kennung in ein Service-Verfahren gelangt. Käme er leer durch,
    // liefe die Operation ohne Einschränkung auf ein Konto weiter.
    const rejection = rejectionOf(() => parameterFactory()(undefined, contextFor({})));

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });
});
