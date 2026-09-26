import { Field, InputType } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

/**
 * Eingabe der Anmelde-Mutation (Requirement 2.5, 9.2; design.md, Abschnitt
 * "GraphQL-Typen").
 *
 * Genau ein Feld, und ausdrücklich keine Konto-Kennung: Wer angemeldet wird,
 * entscheidet allein das geprüfte Google_ID_Token. Jede spätere Operation
 * bezieht ihr Konto aus `@CurrentUser()` und nie aus einem Eingabefeld
 * (Requirement 2.12), sonst wäre die Mandantentrennung mit einem gültigen
 * Token zu umgehen.
 *
 * `@IsNotEmpty()` ist die deklarierte Validierung im Sinne von
 * Requirement 9.2; die globale `ValidationPipe` in `main.ts` bildet eine
 * Verletzung über `createValidationException` auf `BAD_USER_INPUT` samt dem
 * Pfad `idToken` innerhalb der Eingabe ab. Ein `@IsString()` steht bewusst
 * nicht daneben: Über den Typ entscheidet bereits der Skalar `String!` des
 * erzeugten Schemas, der eine Anfrage mit einem anderen Typ ablehnt, bevor die
 * Pipe läuft. Die leere Zeichenkette ist der einzige Wert, den der Skalar
 * durchlässt und der als Token keinen Sinn hat — genau ihn fängt diese Regel.
 *
 * Eine Längenbegrenzung fehlt mit Absicht: Ein zu langes oder sonst
 * fehlerhaftes Token ist keine Eingabeverletzung, sondern ein ungültiges Token,
 * und `GoogleTokenVerifier` lehnt es mit `UNAUTHENTICATED` ab
 * (Requirement 2.3). Eine eigene Grenze hier würde denselben Fall mit einem
 * zweiten Fehlercode beantworten.
 */
@InputType({ description: 'Das von Google ausgestellte ID-Token einer Anmeldung.' })
export class SignInWithGoogleInput {
  @Field(() => String, { description: 'Das Google_ID_Token, wie Google es ausgestellt hat.' })
  @IsNotEmpty()
  idToken!: string;
}
