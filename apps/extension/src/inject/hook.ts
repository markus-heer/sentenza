/**
 * Seitenkontext (`world: MAIN`), Start zu `document_start`.
 *
 * Nur hier sind `window.fetch` und `XMLHttpRequest` der Busuu-Seite erreichbar;
 * die `chrome.*`-Schnittstellen sind es nicht. Deshalb umhüllt diese Datei die
 * beiden Netzwerk-Schnittstellen und gibt Treffer über `window.postMessage` an
 * `content/bridge.ts` weiter, das im isolierten Kontext läuft.
 *
 * Gerüst: Die Umhüllung von `fetch` und `XMLHttpRequest` entsteht in Aufgabe
 * 16.5, die Weitergabe an die Brücke in Aufgabe 16.7.
 */
console.debug('[Sentenza] Seitenkontext geladen.');
