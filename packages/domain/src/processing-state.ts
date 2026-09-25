/**
 * Verarbeitungszustand: der Stand der Normalisierung eines Eintrags im
 * Raw_Payload_Store.
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 1.4).
 */
export enum ProcessingState {
  /** Ohne Fehler und ohne verworfene Einträge abgeschlossen. */
  VERARBEITET = 'VERARBEITET',
  /** Abgeschlossen, mindestens ein Eintrag wurde verworfen. */
  TEILWEISE_VERARBEITET = 'TEILWEISE_VERARBEITET',
  /** Abgebrochen, keine Änderung am normalisierten Datenbestand. */
  FEHLGESCHLAGEN = 'FEHLGESCHLAGEN',
}
