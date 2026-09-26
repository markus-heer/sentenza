/**
 * Service Worker der Erweiterung, im Manifest als ES-Modul deklariert.
 *
 * Hier laufen Anmeldung, Warteschlange und Übertragung zusammen. Ein
 * MV3-Service-Worker kann jederzeit beendet werden; der gesamte Zustand liegt
 * deshalb in `chrome.storage.local` und nie nur im Speicher dieses Skripts.
 *
 * Gerüst: Warteschlange und Zustand entstehen in Aufgabe 16.8, die Anmeldung in
 * 16.10, die Erneuerung in 16.11, die Übertragung samt Wiederholkette in 16.13
 * und die Absicherung über `chrome.alarms` in 16.15.
 */
console.debug('[Sentenza] Hintergrunddienst gestartet.');
