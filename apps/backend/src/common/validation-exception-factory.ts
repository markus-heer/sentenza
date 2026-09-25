import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import type { ValidationError } from 'class-validator';

/**
 * Eine einzelne verletzte Stelle einer GraphQL-Eingabe, benannt über ihren
 * Pfad innerhalb der Eingabe (Requirement 9.2).
 */
export interface ValidationViolation {
  readonly path: string;
  readonly constraints: readonly string[];
}

/**
 * Baut den Feldpfad einer `class-validator`-`ValidationError` unter
 * Berücksichtigung des Elternpfads auf, zum Beispiel `input.content` oder
 * `input.items.0.name` bei verschachtelten Eingaben.
 */
function buildPath(parentPath: string, error: ValidationError): string {
  const segment = error.property;
  return parentPath.length > 0 ? `${parentPath}.${segment}` : segment;
}

/**
 * Bildet eine (verschachtelte) Liste von `class-validator`-`ValidationError`
 * rekursiv auf flache `ValidationViolation`-Einträge ab. Jede Ebene mit
 * eigenen `constraints` erzeugt einen Eintrag; verschachtelte `.children`
 * (etwa bei einem Eingabeobjekt oder einer Liste als Feld) werden mit dem
 * jeweils aufgebauten Pfad rekursiv aufgelöst.
 */
function flattenValidationErrors(
  errors: readonly ValidationError[],
  parentPath = '',
): ValidationViolation[] {
  const violations: ValidationViolation[] = [];

  for (const error of errors) {
    const path = buildPath(parentPath, error);

    if (error.constraints && Object.keys(error.constraints).length > 0) {
      violations.push({ path, constraints: Object.values(error.constraints) });
    }

    if (error.children && error.children.length > 0) {
      violations.push(...flattenValidationErrors(error.children, path));
    }
  }

  return violations;
}

/**
 * `exceptionFactory` für Nests globale `ValidationPipe` (design.md,
 * Abschnitt "Apollo-Fehlerformatierer"; Requirement 9.2).
 *
 * Wandelt die von `class-validator` erzeugten `ValidationError`-Objekte in
 * einen einzigen `SentenzaError` mit Code `BAD_USER_INPUT` und
 * `details.violations`, das jedes verletzte Feld mit seinem Pfad innerhalb
 * der Eingabe benennt. `formatError` behandelt das Ergebnis über den
 * bestehenden `SentenzaError`-Zweig einheitlich, ohne einen eigenen
 * Sonderfall für Validierungsfehler zu benötigen.
 *
 * Bewusst als eigenständige, exportierte Funktion gehalten (statt inline in
 * der `ValidationPipe`-Konfiguration), damit sie ohne laufendes Nest und
 * ohne echte DTOs anhand synthetischer `ValidationError[]`-Eingaben getestet
 * werden kann.
 */
export function createValidationException(errors: ValidationError[]): SentenzaError {
  const violations = flattenValidationErrors(errors);

  return new SentenzaError(
    SentenzaErrorCode.BAD_USER_INPUT,
    'Eingabe verletzt die deklarierte Validierung.',
    { violations },
  );
}
