import 'reflect-metadata';

import { RESOLVER_TYPE_METADATA } from '@nestjs/graphql';
import { SentenzaError, SentenzaErrorCode, TargetLanguage } from '@sentenza/domain';
import { describe, expect, it } from 'vitest';

import type { AuthenticatedAccount } from '../../auth/authenticated-account.js';
import { IS_PUBLIC_KEY } from '../../auth/public.decorator.js';
import { CatalogResolver, type CatalogResolverService } from '../catalog.resolver.js';
import type { GrammarCatalogQuery } from '../catalog.service.js';
import { GrammarCategory } from '../models/grammar-category.model.js';

/**
 * Tests für `CatalogResolver` (Requirement 2.10, 2.12, 7.1).
 *
 * Kein Nest-Container: Der Resolver wird von Hand instanziiert, `CatalogService`
 * ist eine Attrappe, die mitschreibt, womit sie aufgerufen wurde. Damit ist
 * genau das prüfbar, was dieser Resolver selbst zu verantworten hat — welches
 * Argument und welche Konto-Kennung in die Abfrage gehen, dass das Ergebnis
 * unverändert durchgeht und dass eine Ablehnung nicht unterwegs verändert wird.
 *
 * Dass die Query im erzeugten Schema steht und nicht ausgenommen ist, prüft
 * zusätzlich Property 29 in `auth/__tests__/gql-auth.guard.test.ts` gegen
 * `schema.gql`; hier werden die Metadaten unmittelbar an der Klasse gelesen.
 */

const ACCOUNT: AuthenticatedAccount = {
  id: 'konto-des-angemeldeten-benutzers',
  email: 'nutzer@example.com',
};

/** Ein Ergebnis mit einer Kategorie ohne Themen; der Inhalt ist hier gleichgültig. */
const RESULT: GrammarCategory[] = [
  Object.assign(new GrammarCategory(), {
    busuuId: 'cat_1',
    language: TargetLanguage.ES,
    nameDe: 'Bezeichnung de',
    nameEn: 'Bezeichnung en',
    descriptionDe: 'Beschreibung de',
    descriptionEn: 'Beschreibung en',
    removedFromCatalog: false,
    topics: [],
  }),
];

/**
 * `CatalogService` als Attrappe. Sie erfüllt `CatalogResolverService` und damit
 * genau das eine Verfahren, das der Resolver aufruft — Prisma, Ordnung und
 * Abbildung bleiben aus dem Spiel.
 */
function resolverWith(behaviour: { reject?: SentenzaError } = {}): {
  resolver: CatalogResolver;
  calls: GrammarCatalogQuery[];
} {
  const calls: GrammarCatalogQuery[] = [];

  const catalogService: CatalogResolverService = {
    findGrammarCatalog: (query) => {
      calls.push(query);

      return behaviour.reject === undefined
        ? Promise.resolve(RESULT)
        : Promise.reject(behaviour.reject);
    },
  };

  return { resolver: new CatalogResolver(catalogService), calls };
}

describe('grammarCatalog', () => {
  it('übergibt Zielsprache und Konto-Kennung an den Service und gibt dessen Ergebnis unverändert zurück', async () => {
    const { resolver, calls } = resolverWith();

    const categories = await resolver.grammarCatalog(TargetLanguage.ES, ACCOUNT);

    expect(categories).toBe(RESULT);
    // Requirement 2.12: Die Konto-Kennung stammt aus `@CurrentUser()` und
    // damit aus dem Access-Token, nicht aus einem Eingabefeld.
    expect(calls).toEqual([{ userAccountId: ACCOUNT.id, language: TargetLanguage.ES }]);
  });

  it('reicht die Ablehnung des Service unverändert weiter', async () => {
    const rejection = new SentenzaError(
      SentenzaErrorCode.BAD_USER_INPUT,
      'Die Zielsprache wird nicht unterstützt.',
    );
    const { resolver } = resolverWith({ reject: rejection });

    // Keine Umformung im Resolver: `formatError` bildet den Fehlercode ab
    // (Requirement 9.1), nicht diese Klasse.
    await expect(resolver.grammarCatalog(TargetLanguage.ES, ACCOUNT)).rejects.toBe(rejection);
  });

  it('ist das einzige Feld des Resolvers, erklärt als Query, und nicht von der Anmeldepflicht ausgenommen', () => {
    // Requirement 7.8: Das Schema entsteht code-first aus den Decorators; das
    // Feld ist eine Query und keine Mutation, denn es liest nur.
    const fields = Object.getOwnPropertyNames(CatalogResolver.prototype).filter(
      (name) =>
        Reflect.getMetadata(
          RESOLVER_TYPE_METADATA,
          Object.getOwnPropertyDescriptor(CatalogResolver.prototype, name)?.value,
        ) === 'Query',
    );
    expect(fields).toEqual(['grammarCatalog']);

    // Requirement 2.10: kein `@Public()` — weder an der Klasse noch am Feld.
    // Damit greift der global registrierte `GqlAuthGuard` ohne weiteres Zutun.
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, CatalogResolver)).toBeUndefined();
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, CatalogResolver.prototype.grammarCatalog),
    ).toBeUndefined();
  });
});
