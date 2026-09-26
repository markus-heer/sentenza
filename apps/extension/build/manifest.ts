import { z } from 'zod';

/**
 * Bau des Manifests von Sentenza_Extension (Requirement 8.1, 8.5).
 *
 * `apps/extension/manifest.json` ist die eingecheckte Quelle. Der Build prüft
 * sie gegen das Schema dieser Datei und schreibt das Ergebnis nach
 * `dist/manifest.json`, wobei die Host-Berechtigung des Backends aus der
 * konfigurierten Adresse abgeleitet wird. Die Erweiterung hat zur Laufzeit
 * kein `process.env`; jede Konfiguration muss deshalb zur Bauzeit einfließen
 * (design.md, Abschnitt "Sentenza_Extension": die Backend-Adresse ist über den
 * Build konfigurierbar, eine andere Adresse verlangt eine Manifest-Änderung —
 * dynamische Host-Berechtigungen würden `optional_host_permissions` und eine
 * Zustimmungsabfrage verlangen, was für den lokalen Betrieb unnötig ist).
 *
 * Diese Datei läuft ausschließlich zur Bauzeit unter Node. Sie ist kein
 * Bestandteil der ausgelieferten Erweiterung.
 */

/** Adresse der GraphQL_API, falls `SENTENZA_BACKEND_URL` nicht gesetzt ist. */
export const DEFAULT_BACKEND_URL = 'http://localhost:4000/graphql';

/**
 * Die einzigen zulässigen Host-Muster der Datenquelle. `*.busuu.com` umfasst
 * die Domäne selbst und ihre Unterdomänen; eine Berechtigung für alle Adressen
 * wird ausdrücklich nicht deklariert (Requirement 8.1).
 */
export const BUSUU_MATCH_PATTERNS = ['https://*.busuu.com/*'] as const;

/** Die drei Berechtigungen, mehr verlangt die Erweiterung nicht (Requirement 8.1). */
export const REQUIRED_PERMISSIONS = ['storage', 'identity', 'alarms'] as const;

const busuuMatchSchema = z.enum(BUSUU_MATCH_PATTERNS);

/**
 * Zwei Content-Script-Einträge auf dieselbe Seite sind Absicht und kein
 * Versehen (design.md, Abschnitt "Abfangen"): `world: MAIN` läuft im
 * Seitenkontext und kann `fetch` und `XMLHttpRequest` der Seite umhüllen,
 * erreicht aber die `chrome.*`-Schnittstellen nicht. `world: ISOLATED` erreicht
 * `chrome.runtime`, sieht aber die Seitenobjekte nicht. Beide starten zu
 * `document_start`, damit die Umhüllung vor dem ersten Netzwerkaufruf der Seite
 * steht (Requirement 8.5).
 */
const contentScriptSchema = z
  .object({
    matches: z.array(busuuMatchSchema).nonempty(),
    js: z.array(z.string().min(1)).nonempty(),
    run_at: z.literal('document_start'),
    world: z.enum(['MAIN', 'ISOLATED']),
  })
  .strict();

const manifestSchema = z
  .object({
    manifest_version: z.literal(3),
    name: z.string().min(1),
    version: z.string().regex(/^\d+(\.\d+){0,3}$/, 'Version muss aus bis zu vier Zahlen bestehen'),
    description: z.string().min(1),
    // `world: MAIN` gibt es erst ab Chrome 111. Ohne diese Angabe lädt eine
    // ältere Version die Erweiterung und verwirft den Eintrag stillschweigend.
    minimum_chrome_version: z.string().regex(/^\d+$/),
    permissions: z
      .array(z.enum(REQUIRED_PERMISSIONS))
      .refine(
        (permissions) =>
          permissions.length === REQUIRED_PERMISSIONS.length &&
          REQUIRED_PERMISSIONS.every((permission) => permissions.includes(permission)),
        `permissions muss genau ${REQUIRED_PERMISSIONS.join(', ')} enthalten`,
      ),
    host_permissions: z.array(z.string().min(1)).nonempty(),
    background: z
      .object({
        service_worker: z.string().min(1),
        // Der Service Worker ist ein ES-Modul; nur so darf er `import`
        // verwenden, was das Bündel des Hintergrunddienstes voraussetzt.
        type: z.literal('module'),
      })
      .strict(),
    action: z
      .object({
        default_popup: z.string().min(1),
        default_title: z.string().min(1).optional(),
      })
      .strict(),
    content_scripts: z
      .array(contentScriptSchema)
      .refine(
        (entries) =>
          entries.filter((entry) => entry.world === 'MAIN').length === 1 &&
          entries.filter((entry) => entry.world === 'ISOLATED').length === 1 &&
          entries.length === 2,
        'content_scripts muss genau einen MAIN- und einen ISOLATED-Eintrag enthalten',
      ),
  })
  .strict();

/** Gestalt des Manifests, wie der Build sie nach `dist` schreibt. */
export type ChromeManifest = z.infer<typeof manifestSchema>;

/**
 * Leitet aus der Adresse der GraphQL_API das Host-Muster für
 * `host_permissions` ab: Schema und Host der Adresse, alle Pfade darunter.
 *
 * Ein Platzhalter im Host wird abgewiesen — er würde die Berechtigung über den
 * konfigurierten Ursprung hinaus ausweiten und damit Requirement 8.1
 * verletzen.
 */
export function toBackendHostPermission(backendUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(backendUrl);
  } catch {
    throw new Error(
      `SENTENZA_BACKEND_URL ist keine gültige Adresse: ${backendUrl}. Erwartet wird etwa ${DEFAULT_BACKEND_URL}.`,
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `SENTENZA_BACKEND_URL muss http oder https verwenden, gefunden: ${parsed.protocol}`,
    );
  }

  if (parsed.host.includes('*')) {
    throw new Error(
      `SENTENZA_BACKEND_URL darf keinen Platzhalter im Host enthalten, gefunden: ${parsed.host}`,
    );
  }

  return `${parsed.protocol}//${parsed.host}/*`;
}

/**
 * Prüft die eingecheckte Manifest-Quelle und setzt die Host-Berechtigungen auf
 * genau die Busuu-Muster und den Ursprung der konfigurierten Backend-Adresse.
 *
 * Das Ersetzen statt Ergänzen ist der Kern der Zusage aus Requirement 8.1:
 * Was in der Quelle an zusätzlichen Host-Berechtigungen steht — auch eine
 * Berechtigung für alle Adressen — erreicht das gebaute Manifest nicht.
 */
export function resolveManifest(
  source: unknown,
  options: { readonly backendUrl: string },
): ChromeManifest {
  const manifest = manifestSchema.parse(source);

  return {
    ...manifest,
    host_permissions: [...BUSUU_MATCH_PATTERNS, toBackendHostPermission(options.backendUrl)],
  };
}
