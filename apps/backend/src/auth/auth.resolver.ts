import { Args, Mutation, Resolver } from '@nestjs/graphql';

import { AccessTokenPayload } from './models/access-token-payload.model.js';
import { AuthPayload } from './models/auth-payload.model.js';
import { RefreshAccessTokenInput } from './models/refresh-access-token.input.js';
import { SignInWithGoogleInput } from './models/sign-in-with-google.input.js';
import { Public } from './public.decorator.js';

/**
 * Die Fähigkeiten von Auth_Service, die dieser Resolver aufruft.
 *
 * Bewusst als Schnittstelle geschnitten und nicht als `AuthService`
 * hingeschrieben — aus demselben Grund wie `AuthStore` und
 * `GoogleIdentityVerifier` in `auth.service.ts`: Der Resolver ist damit ohne
 * Abhängigkeitsbaum, ohne Datenbank und ohne Netzzugriff prüfbar, und eine
 * Attrappe muss nur diese zwei Verfahren mitbringen statt die ganze Klasse
 * samt ihrer privaten Mitspieler nachzubilden. Dass `AuthService` diese Form
 * erfüllt, bestätigt der Type-Check an der Erzeugungsstelle in
 * `auth.module.ts`.
 *
 * Die Rückgabetypen sind die GraphQL-Modelle und nicht `AuthTokens` bzw.
 * `AccessTokenResult`: Beide Formen sind gleich, und diese Schreibweise hält
 * genau das fest. Weicht der Service künftig ab, schlägt der Type-Check in
 * `auth.module.ts` fehl und nicht erst der Betrieb.
 */
export interface AuthResolverService {
  signInWithGoogle(idToken: string): Promise<AuthPayload>;
  refreshAccessToken(refreshToken: string): Promise<AccessTokenPayload>;
}

/**
 * Anmelde- und Erneuerungs-Mutation der GraphQL_API (Requirement 2.5, 2.9,
 * 9.2; design.md, Abschnitt "Auth-Modul").
 *
 * Ein dünner Umschlag: Beide Felder packen genau ein Feld der Eingabe aus,
 * rufen Auth_Service und geben dessen Ergebnis unverändert zurück. Keine
 * Fehlerbehandlung, keine Umformung, keine Bedingung — die gesamte fachliche
 * Entscheidung liegt im Service, und `formatError` bildet einen
 * `SentenzaError` daraus auf Fehlercode und Korrelationskennung ab
 * (Requirement 9.1). Ein `try`/`catch` hier würde diese Kette nur verdecken.
 *
 * Beide Felder tragen `@Public()` und sind damit die beiden einzigen Ausnahmen,
 * die Requirement 2.10 zulässt. Der Grund ist zwingend: Die Anmeldung stellt
 * das Access-Token erst aus, und die Erneuerung wird gerade dann gebraucht,
 * wenn das vorhandene abgelaufen ist. Jede weitere Operation bleibt durch den
 * global registrierten `GqlAuthGuard` geschützt, ohne dass jemand daran denken
 * muss; Property 29 zählt die Felder des erzeugten Schemas auf und lässt eine
 * dritte Ausnahme nicht durch.
 *
 * Kein Feld dieses Resolvers nimmt eine Konto-Kennung an, und keines liest
 * `@CurrentUser()` — beides wäre hier auch nicht möglich, weil vor der
 * Anmeldung kein Konto im Kontext liegt. Welches Konto betroffen ist,
 * entscheidet ausschließlich das vorgelegte Token (Requirement 2.12).
 *
 * Der Typ des Arguments steht ausdrücklich in `@Args(..., { type: () => … })`
 * und nicht nur als TypeScript-Annotation. Sonst müsste NestJS ihn aus den von
 * `emitDecoratorMetadata` erzeugten Reflexionsdaten lesen — die entstehen aber
 * nur beim Übersetzen mit `tsc`. Der Testlauf übersetzt mit esbuild, das diese
 * Daten nicht erzeugt; ein Test, der die Anwendung hochfährt und das Schema
 * erzeugen lässt (Aufgabe 17.4), stünde dann vor einem Argument ohne Typ. Mit
 * der ausdrücklichen Angabe ist das Schema unabhängig vom Übersetzer dasselbe.
 *
 * `revokeRefreshToken` von Auth_Service hat hier absichtlich kein Gegenstück:
 * Der Entwurf nennt für das Auth-Modul genau diese zwei Mutationen, und eine
 * Abmeldung ist in diesem Spec nicht gefordert. Der Widerruf bleibt damit
 * vorerst ohne Schnittstelle, statt ein nicht abgestimmtes Feld ins Schema zu
 * setzen, das `@sentenza/api-client` anschließend mit erzeugt.
 */
@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthResolverService) {}

  @Public()
  @Mutation(() => AuthPayload, {
    description:
      'Meldet ein Google-Konto an und gibt Access- und Refresh-Token samt Ablaufzeitpunkten zurück.',
  })
  signInWithGoogle(
    @Args('input', { type: () => SignInWithGoogleInput }) input: SignInWithGoogleInput,
  ): Promise<AuthPayload> {
    return this.authService.signInWithGoogle(input.idToken);
  }

  @Public()
  @Mutation(() => AccessTokenPayload, {
    description:
      'Stellt ohne erneute Google-Anmeldung ein neues Access-Token aus; das Refresh-Token bleibt unverändert gültig.',
  })
  refreshAccessToken(
    @Args('input', { type: () => RefreshAccessTokenInput }) input: RefreshAccessTokenInput,
  ): Promise<AccessTokenPayload> {
    return this.authService.refreshAccessToken(input.refreshToken);
  }
}
