import { registerEnumType } from '@nestjs/graphql';
import {
  CefrLevel,
  PayloadKind,
  ProcessingState,
  SubmissionSource,
  TargetLanguage,
} from '@sentenza/domain';

/**
 * Meldet die aus `@sentenza/domain` importierten Enumerationen bei GraphQL an.
 *
 * Die Enumerationen werden nicht im Backend deklariert, sondern importiert
 * und hier per `registerEnumType` angemeldet, damit es je Enumeration genau
 * einen Deklarationsort für Prisma-Modell, GraphQL-Schema, Backend-Logik und
 * Extension gibt (design.md, Abschnitt "GraphQL-Typen"; Requirement 1.4).
 *
 * `SentenzaErrorCode` ist ausdrücklich nicht enthalten: er ist keine
 * GraphQL-exponierte Enumeration, sondern ein Fehlercode-Wert in
 * `extensions.code` der Fehlerantwort (Requirement 9.1), siehe Aufgabe 4.5.
 *
 * Muss vor `GraphQLModule.forRoot` ausgeführt werden, damit die Typen beim
 * Erzeugen des Schemas bereits bekannt sind. Wird als Seiteneffekt beim
 * Import dieses Moduls in `app.module.ts` ausgeführt.
 */
registerEnumType(PayloadKind, {
  name: 'PayloadKind',
  description: 'Die Kennzeichnung der Struktur eines eingereichten Payloads.',
});

registerEnumType(ProcessingState, {
  name: 'ProcessingState',
  description: 'Der Stand der Normalisierung eines Eintrags im Raw_Payload_Store.',
});

registerEnumType(SubmissionSource, {
  name: 'SubmissionSource',
  description: 'Die Angabe, welcher Client einen Payload eingereicht hat.',
});

registerEnumType(CefrLevel, {
  name: 'CefrLevel',
  description: 'Das Niveau eines Grammatik_Thema nach dem europäischen Referenzrahmen.',
});

registerEnumType(TargetLanguage, {
  name: 'TargetLanguage',
  description: 'Die von Sentenza unterstützte Lernsprache.',
});
