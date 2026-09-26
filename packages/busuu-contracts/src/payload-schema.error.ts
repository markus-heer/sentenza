import { PayloadKind } from '@sentenza/domain';
import type { ZodError, ZodIssue } from 'zod';

/** Bezeichnung der Payload-Art, wie sie in Fehlermeldungen erscheint. */
const PAYLOAD_KIND_LABEL: Record<PayloadKind, string> = {
  [PayloadKind.CATALOG]: 'Katalog-Payload',
  [PayloadKind.PROGRESS]: 'Lernstands-Payload',
};

/** Pfadangabe für eine Verletzung, die nicht an einem Feld, sondern an der Wurzel liegt. */
const ROOT_PATH = '(Wurzel)';

/**
 * Formt den Pfad einer Zod-Verletzung in eine lesbare Punkt-Notation um;
 * Array-Indizes erscheinen in eckigen Klammern
 * (`grammar_categories[0].content.name`).
 */
function formatIssuePath(path: ReadonlyArray<string | number>): string {
  if (path.length === 0) {
    return ROOT_PATH;
  }

  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') {
      return `${formatted}[${segment}]`;
    }
    return formatted.length === 0 ? segment : `${formatted}.${segment}`;
  }, '');
}

/**
 * PayloadSchemaError: der Fehler, mit dem das Parsen eines rohen Busuu-Payloads
 * abbricht (Requirement 6.2).
 *
 * Die Meldung nennt die Payload-Art und den Pfad der **ersten** verletzten
 * Stelle innerhalb des Payloads — bei Zod ist das `issues[0].path`. Der Pfad
 * steht zusätzlich als eigenes Feld bereit, damit Aufrufer ihn ohne Zerlegen
 * der Meldung protokollieren können.
 *
 * Bewusst **kein** `SentenzaError`: Ein schemawidriger Payload erreicht den
 * Client nicht als GraphQL-Fehler. Ingestion_Service fängt diesen Fehler,
 * hinterlegt die Meldung am erhaltenen Eintrag des Raw_Payload_Store und
 * setzt den Verarbeitungszustand auf `FEHLGESCHLAGEN` (Requirement 3.5).
 * Deshalb trägt der Fehler keinen Fehlercode und dieses Paket bleibt frei von
 * Annahmen über die GraphQL-Schicht.
 */
export class PayloadSchemaError extends Error {
  constructor(
    readonly payloadKind: PayloadKind,
    /** Pfad der ersten verletzten Stelle, `(Wurzel)` bei einer Verletzung am Payload selbst. */
    readonly path: string,
    /** Meldung der ersten verletzten Stelle, wie von Zod formuliert. */
    readonly reason: string,
  ) {
    super(
      `${PAYLOAD_KIND_LABEL[payloadKind]} verletzt das Schema an der Stelle ${path}: ${reason}`,
    );
    this.name = 'PayloadSchemaError';
  }

  /**
   * Bildet einen `ZodError` auf einen `PayloadSchemaError` ab und benennt dabei
   * ausschließlich die erste Verletzung (Requirement 6.2).
   */
  static fromZodError(payloadKind: PayloadKind, error: ZodError): PayloadSchemaError {
    const firstIssue: ZodIssue | undefined = error.issues[0];

    return new PayloadSchemaError(
      payloadKind,
      firstIssue === undefined ? ROOT_PATH : formatIssuePath(firstIssue.path),
      firstIssue?.message ?? 'unbekannte Schemaverletzung',
    );
  }

  /**
   * Bildet einen nicht als JSON lesbaren Payload-Inhalt ab. Die Verletzung liegt
   * am Payload selbst, nicht an einem seiner Felder, daher `(Wurzel)`.
   */
  static fromInvalidJson(payloadKind: PayloadKind, cause: unknown): PayloadSchemaError {
    const reason = cause instanceof Error ? cause.message : 'Inhalt ist kein gültiges JSON';

    return new PayloadSchemaError(payloadKind, ROOT_PATH, reason);
  }
}
