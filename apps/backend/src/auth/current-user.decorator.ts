import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';

import type { AuthenticatedAccount, AuthenticatedGraphQLContext } from './authenticated-account.js';

/**
 * Nachricht, wenn kein Konto im Kontext liegt. Gleichlautend mit der Ablehnung
 * durch `GqlAuthGuard`, damit ein Client aus der Antwort nicht ablesen kann, ob
 * der Guard gelaufen ist.
 */
const UNAUTHENTICATED_MESSAGE = 'Für diese Operation ist eine Anmeldung erforderlich.';

/**
 * Liest das angemeldete Benutzerkonto aus dem GraphQL-Kontext
 * (Requirement 2.10, 2.12; design.md, Abschnitt "Guard und Request-Kontext").
 *
 * Als gewöhnliche Funktion herausgezogen und nicht in `createParamDecorator`
 * eingebettet: Ein Parameter-Dekorator ist von außen nicht aufrufbar, diese
 * Funktion schon. Das Verhalten ist damit ohne laufende Nest-Anwendung prüfbar,
 * wie es die Testkonvention des Backends verlangt.
 *
 * `GqlAuthGuard` legt das Konto unmittelbar am Kontext ab; ohne ihn steht dort
 * nichts. Die Abwesenheit ergibt deshalb `UNAUTHENTICATED` und nicht
 * `undefined`: Ein Resolver, der `@CurrentUser()` verlangt, aber irrtümlich mit
 * `@Public()` versehen ist, darf nicht mit einem leeren Konto weiterarbeiten
 * und so Entitäten ohne Zuordnung lesen oder schreiben (Requirement 2.12).
 * Dieser Fall ist ein Programmierfehler, hat aber dieselbe Antwort wie ein
 * fehlendes Token — nach außen ist beides eine nicht angemeldete Operation.
 */
export function currentUserFromContext(context: ExecutionContext): AuthenticatedAccount {
  const graphqlContext =
    GqlExecutionContext.create(context).getContext<AuthenticatedGraphQLContext>();
  const account = graphqlContext.user;

  if (account === undefined || account === null) {
    throw new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }

  return account;
}

/**
 * Das angemeldete Benutzerkonto als Parameter eines Resolvers
 * (design.md: "Resolver greifen über `@CurrentUser()` darauf zu").
 *
 * Der einzige Weg, auf dem eine Konto-Kennung in ein Service-Verfahren gelangt.
 * Kein Eingabefeld einer Mutation oder Query trägt sie — sonst könnte ein
 * Client die Kennung eines fremden Kontos einsetzen und Requirement 2.12 wäre
 * mit einem gültigen Token zu umgehen.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAccount =>
    currentUserFromContext(context),
);
