import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { AuthGuard } from '@nestjs/passport';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import { JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import type { AuthenticatedAccount, AuthenticatedGraphQLContext } from './authenticated-account.js';
import { ACCESS_TOKEN_STRATEGY_NAME } from './jwt.strategy.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

/**
 * Nachricht der Ablehnung einer geschützten Operation (Requirement 2.11).
 *
 * Gleichlautend für alle in Requirement 2.11 aufgezählten Fälle — fehlendes,
 * unlesbares, falsch signiertes, abgelaufenes und keinem Konto zuordenbares
 * Token. Welcher davon zutrifft, steht im Protokoll (Requirement 9.3).
 */
const UNAUTHENTICATED_MESSAGE = 'Für diese Operation ist eine Anmeldung erforderlich.';

/**
 * Grund einer Ablehnung durch den Guard, in der Aufzählung von
 * Requirement 2.11. Erscheint ausschließlich im Protokolleintrag.
 *
 * - `missing-token` — die Anfrage trug keine Kopfzeile `Authorization: Bearer …`.
 * - `expired` — `exp` ist um mehr als die zugestandene Toleranz überschritten.
 * - `invalid-token` — unlesbar, falsch signiert oder mit unerwartetem `iss`.
 * - `missing-request` — der GraphQL-Kontext trug keine Anfrage, die sich prüfen
 *   ließe. Kein Tokendefekt, sondern eine Verdrahtungsfrage; die Operation wird
 *   dennoch abgelehnt, weil eine nicht prüfbare Anfrage nicht als angemeldet
 *   gelten darf.
 * - `rejected` — die Strategie hat abgelehnt, ohne einen der obigen Fälle zu
 *   nennen.
 */
export type AccessDenialReason =
  'missing-token' | 'expired' | 'invalid-token' | 'missing-request' | 'rejected';

/**
 * Nachricht, mit der `passport-jwt` eine Anfrage ohne Token meldet. Die
 * Bibliothek gibt dafür einen gewöhnlichen `Error` ohne eigene Klasse, deshalb
 * ist die Nachricht der einzige Anhaltspunkt.
 */
const NO_TOKEN_MESSAGE = 'No auth token';

/** Ordnet die Angabe von Passport einem Ablehnungsgrund zu (nur für das Protokoll). */
function denialReason(info: unknown): AccessDenialReason {
  if (info instanceof TokenExpiredError) {
    return 'expired';
  }

  if (info instanceof JsonWebTokenError) {
    return 'invalid-token';
  }

  if (info instanceof Error && info.message === NO_TOKEN_MESSAGE) {
    return 'missing-token';
  }

  return 'rejected';
}

/**
 * Global registrierter Guard vor jeder Query und jeder Mutation
 * (Requirement 2.10, 2.11, 2.12; design.md, Abschnitt "Guard und
 * Request-Kontext").
 *
 * Drei Aufgaben, die alle drei nicht bei `AuthGuard('jwt')` aus dem Karton
 * kommen:
 *
 * 1. Die Anfrage liegt bei GraphQL nicht im HTTP-Kontext, sondern im
 *    GraphQL-Kontext — deshalb `getRequest` über `GqlExecutionContext`.
 * 2. Eine Ablehnung muss den Fehlercode `UNAUTHENTICATED` tragen
 *    (Requirement 2.11). Die `UnauthorizedException` von Nest würde der
 *    Apollo-Fehlerformatierer als `INTERNAL_SERVER_ERROR` beantworten, weil sie
 *    kein `SentenzaError` ist — deshalb `handleRequest`.
 * 3. Felder mit `@Public()` sind ausgenommen — deshalb `canActivate`.
 *
 * Trägt absichtlich kein `@Injectable()`: Wie die übrigen Klassen des
 * Auth-Moduls wird der Guard in `auth.module.ts` über eine Factory erzeugt, die
 * ihm `Reflector` übergibt. So ist er ohne Abhängigkeitsbaum prüfbar.
 */
export class GqlAuthGuard extends AuthGuard(ACCESS_TOKEN_STRATEGY_NAME) {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: SentenzaLogger = createLogger({ component: 'auth' }),
  ) {
    super();
  }

  /**
   * Entscheidet über den Zugang zu einem Feld (Requirement 2.10).
   *
   * Die Ausnahme steht vor der Prüfung: Ein Feld mit `@Public()` wird
   * durchgelassen, ohne dass der GraphQL-Kontext oder Passport überhaupt
   * angefasst werden. Das ist auch der Grund, warum der global registrierte
   * Guard den Health-Endpunkt nicht stört — er trägt den Dekorator und
   * verlässt die Methode, bevor eine HTTP-Anfrage als GraphQL-Anfrage gelesen
   * würde.
   *
   * Nach erfolgreicher Prüfung hinterlegt Passport das Konto an der Anfrage;
   * diese Methode stellt es zusätzlich unmittelbar am GraphQL-Kontext bereit,
   * wo `@CurrentUser()` es liest (Requirement 2.10: "das ermittelte
   * Benutzerkonto für die Dauer der Operation bereitstellen").
   */
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) {
      return true;
    }

    // Wirft bei jedem Defekt; ein `false` gibt die Basis nicht zurück.
    await super.canActivate(context);

    const graphqlContext = this.graphqlContext(context);
    graphqlContext.user = graphqlContext.req?.user;

    return true;
  }

  /**
   * Liefert die Anfrage, aus der `passport-jwt` die Kopfzeile `Authorization`
   * liest (design.md: "liest den Header aus `GqlExecutionContext`").
   *
   * Fehlt die Anfrage, wird abgelehnt statt weitergemacht: Der Guard ist die
   * Stelle, die fehlschlagen soll, wenn sie ihre Eingabe nicht findet. Ein
   * `undefined` an dieser Stelle würde die Basis ohne Prüfung bis zum
   * Schreibzugriff auf die Anfrage tragen und dort mit einem technischen
   * Fehler enden.
   */
  override getRequest(context: ExecutionContext): { user?: AuthenticatedAccount } {
    const request = this.graphqlContext(context).req;

    if (request === undefined) {
      throw this.deny('missing-request');
    }

    return request;
  }

  /**
   * Beantwortet das Ergebnis der Prüfung (Requirement 2.11).
   *
   * Bei Erfolg wird das Konto zurückgegeben; die Basis legt es damit an der
   * Anfrage ab. Jeder andere Fall ergibt `UNAUTHENTICATED` — außer einem von
   * der Strategie geworfenen `SentenzaError`, der unverändert weitergereicht
   * wird, weil er den Grund schon protokolliert hat.
   *
   * Die Typvariable und die Behauptung am Ende stammen aus der Signatur der
   * Basis, die das Ergebnis frei wählbar hält (`handleRequest<TUser = any>`).
   * Der Vorgabewert nennt die Form, die dieser Guard tatsächlich liefert;
   * `validate` von `JwtStrategy` ist die einzige Quelle von `user` und gibt
   * ausschließlich `AuthenticatedAccount` zurück.
   */
  override handleRequest<TUser = AuthenticatedAccount>(
    err: unknown,
    user: unknown,
    info: unknown,
  ): TUser {
    if (err instanceof SentenzaError) {
      throw err;
    }

    if (err !== null && err !== undefined) {
      throw this.deny('rejected', err);
    }

    if (user === null || user === undefined || user === false) {
      throw this.deny(denialReason(info), info);
    }

    return user as TUser;
  }

  /** `@Public()` an der Methode übersteuert die Angabe an der Klasse. */
  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private graphqlContext(context: ExecutionContext): AuthenticatedGraphQLContext {
    return GqlExecutionContext.create(context).getContext<AuthenticatedGraphQLContext>();
  }

  /**
   * Protokolliert den Ablehnungsgrund und liefert den Fehler, den die
   * Aufrufstelle wirft (Requirement 2.11).
   *
   * Die Antwort an den Client trägt ausschließlich `UNAUTHENTICATED` und eine
   * für alle Gründe gleichlautende Nachricht; die Unterscheidung steht im
   * Protokoll (Requirement 9.3). Aus der Ursache wird nur Name und Nachricht
   * übernommen, nie der Aufrufstapel — die Redaction des Loggers würde ein
   * mitgesendetes Token ohnehin entfernen (Requirement 9.5).
   */
  private deny(reason: AccessDenialReason, cause?: unknown): SentenzaError {
    this.logger.warn('Zugang zu geschützter Operation abgelehnt', {
      step: 'auth.guard',
      reason,
      ...(cause instanceof Error ? { cause: `${cause.name}: ${cause.message}` } : {}),
    });

    return new SentenzaError(SentenzaErrorCode.UNAUTHENTICATED, UNAUTHENTICATED_MESSAGE);
  }
}
