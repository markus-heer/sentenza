/**
 * Isolierter Kontext (`world: ISOLATED`), Start zu `document_start`.
 *
 * Gegenstück zu `inject/hook.ts`: Diese Datei erreicht `chrome.runtime`, sieht
 * aber die Objekte der Seite nicht. Sie nimmt die Nachrichten des
 * Seitenkontexts an, prüft Ursprung, Nonce und Nachrichtenart und reicht
 * zutreffende Erfassungen an den Hintergrunddienst weiter.
 *
 * Gerüst: Die Prüfung der Nachrichten und die Weitergabe entstehen in Aufgabe
 * 16.7, die Zuordnung der Payload-Art über `classifyUrl` in Aufgabe 16.3.
 */
console.debug('[Sentenza] Brücke geladen.');
