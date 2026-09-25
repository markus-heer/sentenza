/**
 * Quelle der Einreichung: die Angabe, welcher Client einen Payload
 * eingereicht hat.
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 1.4). Derzeit gibt es genau einen unterstützten Wert; das
 * Feld bleibt als Erweiterungspunkt für künftige Clients bestehen.
 */
export enum SubmissionSource {
  SENTENZA_EXTENSION = 'SENTENZA_EXTENSION',
}
