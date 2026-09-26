import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

/**
 * Antwort der Anmelde-Mutation (Requirement 2.5; design.md, Abschnitt
 * "Auth-Modul").
 *
 * Requirement 2.5 verlangt beide Tokens **und** beide Ablaufzeitpunkte in
 * derselben Antwort. Die Ablaufzeitpunkte stehen ausdrücklich als eigene
 * Felder und nicht als Gültigkeitsdauer in Sekunden: Der Service Worker der
 * Extension entscheidet anhand der Restgültigkeit über eine Vorab-Erneuerung
 * (Requirement 8.4) und kann nach einer Unterbrechung nicht wissen, wie viel
 * Zeit seit dem Empfang verstrichen ist. Ein absoluter Zeitpunkt beantwortet
 * die Frage auch nach einem Neustart des Service Workers.
 *
 * Die Form ist gleich der von `AuthTokens` in `auth.service.ts` — absichtlich,
 * damit der Resolver das Ergebnis des Service unverändert zurückgeben kann und
 * keine Abbildungsschicht entsteht, die Felder verwechseln könnte. Der
 * Type-Check bestätigt die Gleichheit an der Rückgabe von
 * `AuthResolver.signInWithGoogle`.
 *
 * `GraphQLISODateTime` ist ausdrücklich angegeben statt sich auf die
 * Rückschlüsse aus den Metadaten zu verlassen: Der Skalar im erzeugten Schema
 * soll nicht davon abhängen, ob `emitDecoratorMetadata` einen `Date`-Typ
 * erkennt.
 */
@ObjectType({
  description:
    'Access- und Refresh-Token einer erfolgreichen Anmeldung, jeweils mit Ablaufzeitpunkt.',
})
export class AuthPayload {
  @Field(() => String, { description: 'Das Sentenza_Access_Token für geschützte Operationen.' })
  accessToken!: string;

  @Field(() => GraphQLISODateTime, {
    description: 'Zeitpunkt, zu dem das Access-Token seine Gültigkeit verliert.',
  })
  accessTokenExpiresAt!: Date;

  @Field(() => String, {
    description: 'Das Sentenza_Refresh_Token für die Erneuerung ohne neue Google-Anmeldung.',
  })
  refreshToken!: string;

  @Field(() => GraphQLISODateTime, {
    description: 'Zeitpunkt, zu dem das Refresh-Token seine Gültigkeit verliert.',
  })
  refreshTokenExpiresAt!: Date;
}
