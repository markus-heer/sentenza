import { type CustomDecorator, SetMetadata } from '@nestjs/common';

/**
 * Metadatenschlüssel, unter dem `@Public()` seine Ausnahme hinterlegt.
 *
 * Mit Namensraum geschrieben, damit er sich nicht mit einem Schlüssel einer
 * Fremdbibliothek überschneiden kann — Metadaten hängen an derselben
 * Reflect-Ablage wie die von Nest und Dritten gesetzten.
 */
export const IS_PUBLIC_KEY = 'sentenza:isPublic';

/**
 * Nimmt ein Feld oder eine Klasse vom Zwang des Access-Tokens aus (design.md,
 * Abschnitt "Guard und Request-Kontext").
 *
 * Der Zuschnitt ist bewusst umgekehrt zur naheliegenden Lösung: `GqlAuthGuard`
 * ist global registriert und schützt damit jede Operation, auch eine erst
 * morgen hinzugefügte (Requirement 2.10). Eine Ausnahme entsteht nur, wo jemand
 * sie ausdrücklich hinschreibt — und ist damit im Diff sichtbar. Ein Guard, der
 * einzeln je Resolver gesetzt wird, kehrt das um: Dort ist das Vergessen
 * lautlos und ungeschützt.
 *
 * Vorgesehen für genau zwei Stellen (Aufgabe 6.12): die Anmelde- und die
 * Erneuerungs-Mutation. Beide können kein Access-Token mitsenden, weil sie es
 * gerade erst ausstellen. Der Health-Endpunkt trägt den Dekorator ebenfalls,
 * weil der global registrierte Guard auch HTTP-Aufrufe erreicht.
 *
 * Wirkt an einer Methode für dieses Feld und an einer Klasse für alle ihre
 * Felder; `GqlAuthGuard` fragt beide Ebenen ab, wobei die Methode die Klasse
 * übersteuert.
 */
export function Public(): CustomDecorator<string> {
  return SetMetadata(IS_PUBLIC_KEY, true);
}
