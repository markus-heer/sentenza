import { Args, Query, Resolver } from '@nestjs/graphql';
import { TargetLanguage } from '@sentenza/domain';

import type { AuthenticatedAccount } from '../auth/authenticated-account.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { GrammarCatalogQuery } from './catalog.service.js';
import { GrammarCategory } from './models/grammar-category.model.js';

/**
 * Die Fähigkeit von `CatalogService`, die dieser Resolver aufruft.
 *
 * Bewusst als Schnittstelle geschnitten und nicht als `CatalogService`
 * hingeschrieben — aus demselben Grund wie `AuthResolverService` in
 * `auth/auth.resolver.ts`: Der Resolver ist damit ohne Abhängigkeitsbaum und
 * ohne Datenbank prüfbar, und eine Attrappe muss nur dieses eine Verfahren
 * mitbringen. Dass `CatalogService` diese Form erfüllt, bestätigt der
 * Type-Check an der Erzeugungsstelle in `catalog.module.ts`.
 */
export interface CatalogResolverService {
  findGrammarCatalog(query: GrammarCatalogQuery): Promise<GrammarCategory[]>;
}

/**
 * Katalog-Query der GraphQL_API (Requirement 7.1, 7.2, 7.8; design.md,
 * Abschnitt "Catalog- und Progress-Abfragemodul").
 *
 * Ein dünner Umschlag: Das Feld setzt die Zielsprache und das angemeldete Konto
 * zu den Argumenten des Service zusammen und gibt dessen Ergebnis unverändert
 * zurück. Keine Sortierung, keine Abbildung, keine Fehlerbehandlung — die liegt
 * im Service, und `formatError` bildet einen `SentenzaError` daraus auf
 * Fehlercode und Korrelationskennung ab (Requirement 9.1).
 *
 * Ohne `@Public()` und damit geschützt, ohne dass hier etwas dafür zu tun wäre:
 * `GqlAuthGuard` ist in `auth/auth.module.ts` global registriert und lässt nur
 * ausdrücklich ausgenommene Felder ohne Access-Token durch (Requirement 2.10).
 * Die Ausnahmen sind Anmeldung und Erneuerung; eine dritte duldet Property 29
 * nicht.
 *
 * Die Konto-Kennung kommt ausschließlich aus `@CurrentUser()`. Ein Eingabefeld
 * dafür gibt es nicht und darf es nicht geben — sonst wäre Requirement 2.12 mit
 * einem gültigen Token zu umgehen. Der Katalog selbst ist nicht kontogebunden,
 * der Lernstand daran schon (Requirement 7.3).
 *
 * Der Typ des Arguments steht ausdrücklich in `@Args(..., { type: () => … })`
 * und nicht nur als TypeScript-Annotation, aus demselben Grund wie in
 * `auth/auth.resolver.ts`: Der Testlauf übersetzt mit esbuild, das keine
 * `emitDecoratorMetadata`-Daten erzeugt. Bei einem Aufzählungstyp wäre die
 * Folge nicht bloß ein unklarer Skalar, sondern ein Argument ohne Typ.
 *
 * Das Filterargument aus dem Entwurf (`grammarCatalog(language, filter)`) fehlt
 * hier noch: Es setzt die GraphQL-Eingabe `GrammarTopicFilter` voraus, und die
 * entsteht mit Aufgabe 13.2 zusammen mit ihrer Auswertung. Die Signatur des
 * Service führt den Parameter bereits (`GrammarCatalogQuery.filter`), sodass
 * dort nur das Argument durchzureichen ist.
 */
@Resolver()
export class CatalogResolver {
  constructor(private readonly catalogService: CatalogResolverService) {}

  @Query(() => [GrammarCategory], {
    description:
      'Die Grammatik_Kategorien einer Zielsprache mit ihren Grammatik_Themen und dem Lernstand des angemeldeten Benutzerkontos.',
  })
  grammarCatalog(
    @Args('language', {
      type: () => TargetLanguage,
      description: 'Die Zielsprache, deren Katalog abgefragt wird.',
    })
    language: TargetLanguage,
    @CurrentUser() account: AuthenticatedAccount,
  ): Promise<GrammarCategory[]> {
    return this.catalogService.findGrammarCatalog({ userAccountId: account.id, language });
  }
}
