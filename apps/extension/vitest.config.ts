import { sentenzaVitestConfig } from '@sentenza/vitest-config';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Die Extension übernimmt die geteilte Vitest-Basis unverändert: Die Tests
 * dieses Pakets laufen ohne Datenbank und ohne Browser. Ergänzungen kommen
 * erst mit den Folgeaufgaben — die Chrome-Attrappen und die Netzabstinenz aus
 * Aufgabe 16.2 sowie eine DOM-Umgebung für die Popup-Tests aus Aufgabe 16.16.
 */
export default mergeConfig(sentenzaVitestConfig, defineConfig({}));
