import { Field, GraphQLISODateTime, Int, ObjectType } from '@nestjs/graphql';

/**
 * Der Lernstand eines Benutzerkontos zu einem Grammatik_Thema
 * (Requirement 7.3; design.md, Abschnitt "Catalog- und Progress-Abfragemodul").
 *
 * Genau drei Felder: Stärke, Prozentwert und Zeitpunkt der letzten Beobachtung.
 * Requirement 7.3 nennt diese drei und keines mehr. Ausdrücklich nicht dabei
 * ist die Konto-Kennung — welches Konto gemeint ist, entscheidet allein das
 * Access-Token der Abfrage (Requirement 2.12), und ein Feld dafür im Ergebnis
 * würde den Eindruck erwecken, es gäbe etwas zu wählen. Ebenso fehlt die
 * Kennung des zugehörigen Grammatik_Thema: Der Lernstand hängt im Ergebnis
 * ohnehin an genau dem Thema, das ihn trägt.
 *
 * Es gibt keine normalisierte Zeitreihe des Lernstands (siehe Steering,
 * Abschnitt "Umgang mit Fremddaten"); `observedAt` ist deshalb der Zeitpunkt
 * der letzten Einreichung, die diesen Stand geliefert hat, und nicht der
 * Anfang eines Verlaufs.
 *
 * Jedes Feld nennt seinen GraphQL-Typ ausdrücklich in `@Field(() => …)`. Der
 * Testlauf übersetzt mit esbuild, das keine `emitDecoratorMetadata`-Daten
 * erzeugt; ohne die Angabe wäre das erzeugte Schema vom Übersetzer abhängig.
 * Das gilt besonders für `Int` und `GraphQLISODateTime`, die ohne Angabe zu
 * `Float` beziehungsweise zu keinem bekannten Skalar würden.
 */
@ObjectType({
  description: 'Der Lernstand des angemeldeten Benutzerkontos zu einem Grammatik_Thema.',
})
export class GrammarProgress {
  @Field(() => Int, { description: 'Die von Busuu gemeldete Stärke, unverändert übernommen.' })
  strength!: number;

  @Field(() => Int, { description: 'Der von Busuu gemeldete Prozentwert, unverändert übernommen.' })
  percentage!: number;

  @Field(() => GraphQLISODateTime, {
    description: 'Zeitpunkt der Einreichung, aus der dieser Lernstand stammt.',
  })
  observedAt!: Date;
}
