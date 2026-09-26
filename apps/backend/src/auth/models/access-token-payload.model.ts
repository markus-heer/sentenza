import { Field, GraphQLISODateTime, ObjectType } from '@nestjs/graphql';

/**
 * Antwort der Erneuerungs-Mutation (Requirement 2.9; design.md, Abschnitt
 * "Auth-Modul").
 *
 * Ausdrücklich ohne Refresh-Token: Eine Rotation findet nicht statt (design.md,
 * Abschnitt "Refresh-Token und Widerruf"), und ein Feld, das dasselbe Token
 * noch einmal zurückgibt, würde eine Rotation nur vortäuschen. Der Client
 * behält das vorgelegte Refresh-Token samt dem bei der Anmeldung erhaltenen
 * Ablaufzeitpunkt.
 *
 * Kein gemeinsamer Basistyp mit `AuthPayload`, obwohl die beiden Felder dort
 * ebenso vorkommen: GraphQL kennt keine Vererbung zwischen Objekttypen, ein
 * `extends` würde also nur die TypeScript-Seite zusammenführen und im erzeugten
 * Schema zwei unabhängige Typen hinterlassen. Die Nähe der beiden Deklarationen
 * ist damit sichtbar statt versteckt.
 */
@ObjectType({
  description: 'Das erneuerte Access-Token mit seinem Ablaufzeitpunkt.',
})
export class AccessTokenPayload {
  @Field(() => String, { description: 'Das neu ausgestellte Sentenza_Access_Token.' })
  accessToken!: string;

  @Field(() => GraphQLISODateTime, {
    description: 'Zeitpunkt, zu dem das Access-Token seine Gültigkeit verliert.',
  })
  accessTokenExpiresAt!: Date;
}
