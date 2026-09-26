/**
 * Zur Bauzeit eingesetzte Konfiguration (Requirement 8.1, 8.2).
 *
 * Die Erweiterung hat zur Laufzeit kein `process.env`. Vite ersetzt die
 * Zugriffe auf `import.meta.env.SENTENZA_*` beim Bündeln durch die Werte aus der
 * `.env` des Monorepos; `envPrefix` in `vite.config.ts` begrenzt die Ersetzung
 * auf genau diese beiden Schlüssel. Die Deklaration steht hier von Hand und
 * nicht über `vite/client`, weil `types` in `tsconfig.json` auf `chrome`
 * begrenzt ist und der Quelltext der Erweiterung nichts von Vite wissen soll.
 */
interface ImportMetaEnv {
  /** Adresse der GraphQL_API, etwa `http://localhost:4000/graphql`. */
  readonly SENTENZA_BACKEND_URL?: string;
  /** Client-Kennung für `chrome.identity.launchWebAuthFlow`. */
  readonly SENTENZA_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
