import { Field, ObjectType } from '@nestjs/graphql';
import {
  CefrLevel,
  PayloadKind,
  ProcessingState,
  SubmissionSource,
  TargetLanguage,
} from '@sentenza/domain';

/**
 * Platzhalter-GraphQL-Typ, der alle fünf per `registerEnumType` angemeldeten
 * Enumerationen aus `@sentenza/domain` referenziert (Aufgabe 4.4).
 *
 * Ein registrierter Enum-Typ erscheint im code-first erzeugten Schema erst,
 * wenn er von mindestens einem Feld erreichbar ist. Da die echten Resolver
 * (Auth, Ingestion, Catalog) erst in späteren Aufgaben entstehen, hält dieser
 * Typ die Enumerationen im generierten `schema.gql` sichtbar. Entfällt,
 * sobald echte Felder diese Enumerationen verwenden.
 */
@ObjectType({
  description: 'Platzhalter-Typ, hält die Domänen-Enumerationen im generierten Schema sichtbar.',
})
export class DomainEnumProbe {
  @Field(() => PayloadKind)
  payloadKind!: PayloadKind;

  @Field(() => ProcessingState)
  processingState!: ProcessingState;

  @Field(() => SubmissionSource)
  submissionSource!: SubmissionSource;

  @Field(() => CefrLevel)
  cefrLevel!: CefrLevel;

  @Field(() => TargetLanguage)
  targetLanguage!: TargetLanguage;

  static sample(): DomainEnumProbe {
    const probe = new DomainEnumProbe();
    probe.payloadKind = PayloadKind.CATALOG;
    probe.processingState = ProcessingState.VERARBEITET;
    probe.submissionSource = SubmissionSource.SENTENZA_EXTENSION;
    probe.cefrLevel = CefrLevel.UNBEKANNT;
    probe.targetLanguage = TargetLanguage.ES;
    return probe;
  }
}
