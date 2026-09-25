/**
 * CEFR_Level: das Niveau eines Grammatik_Thema nach dem europäischen
 * Referenzrahmen.
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 1.4). Bekannte Werte sind `A1`, `A2`, `B1`, `B2`, `C1`;
 * `UNBEKANNT` ist persistierbar für ein Grammatik_Thema, dessen Niveau sich
 * aus dem Payload nicht auf einen bekannten Wert abbilden lässt.
 */
export enum CefrLevel {
  A1 = 'A1',
  A2 = 'A2',
  B1 = 'B1',
  B2 = 'B2',
  C1 = 'C1',
  UNBEKANNT = 'UNBEKANNT',
}
