/**
 * Zur Bauzeit festgelegte Konfiguration der Erweiterung.
 *
 * `BACKEND_URL` muss zum Host-Muster des Manifests passen: Ein Aufruf an eine
 * Adresse ohne passende `host_permissions` schlägt fehl. Beide Werte stammen
 * deshalb aus derselben Quelle — der `.env` des Monorepos, gelesen in
 * `vite.config.ts` (siehe `build/manifest.ts`).
 */

/** Vorgabe, falls `SENTENZA_BACKEND_URL` nicht gesetzt ist. */
const DEFAULT_BACKEND_URL = 'http://localhost:4000/graphql';

/** Adresse der GraphQL_API, an die der Hintergrunddienst überträgt. */
export const BACKEND_URL: string = import.meta.env.SENTENZA_BACKEND_URL ?? DEFAULT_BACKEND_URL;

/**
 * Client-Kennung für `chrome.identity.launchWebAuthFlow` (Requirement 8.2).
 * Ohne gesetzte Kennung bleibt der Wert leer; die Anmeldung aus Aufgabe 16.10
 * meldet das dann als Fehler im Popup, statt einen unbrauchbaren Aufruf zu
 * starten.
 */
export const GOOGLE_CLIENT_ID: string = import.meta.env.SENTENZA_GOOGLE_CLIENT_ID ?? '';
