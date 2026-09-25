/**
 * ConfigValidationError: wird von `loadConfig` geworfen, wenn `process.env`
 * eine benötigte Variable vermissen lässt oder einen unzulässigen Wert
 * enthält (Requirement 1.12).
 *
 * Die Nachricht benennt jede betroffene Variable, nicht nur die erste
 * gefundene, damit ein Betreiber alle Ursachen in einem Anlauf beheben kann.
 */
export class ConfigValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Ungültige Konfiguration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}
