import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

/**
 * Eingabe der Erneuerungs-Mutation (Requirement 2.9, 9.2; design.md, Abschnitt
 * "GraphQL-Typen").
 *
 * Genau ein Feld, und ausdrücklich keine Konto-Kennung: Welches Konto erneuert
 * wird, entscheidet allein der zum Hash des vorgelegten Tokens gespeicherte
 * Datensatz (Requirement 2.12, 2.14). Ein zusätzliches Konto-Feld würde eine
 * Angabe erlauben, die mit dem Token nicht übereinstimmt.
 *
 * `@IsNotEmpty()` ist die deklarierte Validierung im Sinne von
 * Requirement 9.2; eine Verletzung ergibt `BAD_USER_INPUT` mit dem Pfad
 * `refreshToken` innerhalb der Eingabe. Zur Begründung, warum weder
 * `@IsString()` noch eine Längen- oder Formatprüfung daneben steht, siehe
 * `sign-in-with-google.input.ts`: Ein nicht vorlagefähiges Token ist keine
 * Eingabeverletzung, sondern führt nach Requirement 2.14 zu
 * `UNAUTHENTICATED`. Insbesondere wäre eine Prüfung auf base64url verfehlt —
 * sie würde einem Angreifer verraten, welche Form ein ausgestelltes Token hat,
 * und dieselbe Ablehnung mit zwei verschiedenen Fehlercodes beantworten.
 */
@InputType({ description: 'Das vorgelegte Refresh-Token einer Erneuerung.' })
export class RefreshAccessTokenInput {
  @Field(() => String, {
    description: 'Das bei der Anmeldung erhaltene Sentenza_Refresh_Token.',
  })
  @IsNotEmpty()
  refreshToken!: string;
}
