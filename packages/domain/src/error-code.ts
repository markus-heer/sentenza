/**
 * SentenzaErrorCode: der Fehlercode, den GraphQL_API je Fehler genau einmal
 * mitgibt.
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 9.1). Ein Fehler, der keinem dieser Werte zugeordnet ist,
 * wird mit `INTERNAL_SERVER_ERROR` beantwortet.
 */
export enum SentenzaErrorCode {
  /** Fehlendes, syntaktisch unlesbares oder ungültiges Token. */
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  /** E-Mail-Adresse nicht in der Konto_Freigabeliste enthalten. */
  FORBIDDEN = 'FORBIDDEN',
  /** Eingabe verletzt die deklarierte Validierung. */
  BAD_USER_INPUT = 'BAD_USER_INPUT',
  /** Vorübergehende Störung eines Fremdsystems, etwa der Google-JWKS. */
  UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE',
  /** Jeder Fehler, der keinem anderen Wert dieser Enumeration zugeordnet ist. */
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

/**
 * SentenzaError: die einzige Fehlerklasse, die der Apollo-Fehlerformatierer
 * unverändert an den Client weiterreicht (Requirement 9.1, 9.3).
 *
 * Jeder Fehler dieser Klasse trägt genau einen `SentenzaErrorCode`. Ursachen,
 * die nicht als `SentenzaError` geworfen werden, werden vom Fehlerformatierer
 * auf `INTERNAL_SERVER_ERROR` abgebildet.
 */
export class SentenzaError extends Error {
  constructor(
    readonly code: SentenzaErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SentenzaError';
  }
}
