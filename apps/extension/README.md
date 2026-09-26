# @sentenza/extension

Chrome Extension nach Manifest V3. Sie fängt die Antworten des Busuu-Grammatiktrainers im Browser ab und reicht sie unverändert beim lokalen Sentenza-Backend ein.

## Warum zwei Content Scripts

Das Manifest deklariert zwei Content-Script-Einträge auf dieselben Seiten, beide zu `document_start`:

| Eintrag             | Welt       | Aufgabe                                                                                    |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `inject/hook.js`    | `MAIN`     | umhüllt `fetch` und `XMLHttpRequest` der Seite und liest den Antwortinhalt aus             |
| `content/bridge.js` | `ISOLATED` | prüft Ursprung, Nonce und Art der Nachricht und reicht sie an den Hintergrunddienst weiter |

Die Teilung ist notwendig, nicht bequem: Im Seitenkontext (`MAIN`) sind `window.fetch` und `XMLHttpRequest` der Seite erreichbar, die `chrome.*`-Schnittstellen nicht. Im isolierten Kontext (`ISOLATED`) ist es umgekehrt. Die Weitergabe zwischen beiden läuft über `window.postMessage`.

`document_start` ist Bedingung dafür, dass die Umhüllung vor dem ersten Netzwerkaufruf der Seite steht (Requirement 8.5). `world: MAIN` setzt Chrome 111 voraus; das Manifest führt `minimum_chrome_version` entsprechend, weil eine ältere Version den Eintrag stillschweigend verwerfen würde.

Der Weg über einen Content-Script-Eintrag mit `world: MAIN` ersetzt zwei Alternativen, die nicht taugen: `chrome.webRequest` kann in Manifest V3 keine Antwortinhalte lesen, und `chrome.debugger` zeigt eine dauerhafte Debug-Leiste.

## Berechtigungen

`permissions` sind genau `storage`, `identity` und `alarms`. `host_permissions` sind genau die Busuu-Domänen und der Ursprung der konfigurierten Backend-Adresse — keine Berechtigung für alle Adressen (Requirement 8.1).

## Konfiguration

Die Erweiterung hat zur Laufzeit kein `process.env`. Beide Werte fließen zur Bauzeit aus der `.env` des Monorepos ein (siehe `.env.example`):

| Variable                    | Wirkung                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `SENTENZA_BACKEND_URL`      | Ursprung in `host_permissions` des gebauten Manifests und Ziel der Übertragung |
| `SENTENZA_GOOGLE_CLIENT_ID` | Client-Kennung für `chrome.identity.launchWebAuthFlow`                         |

Nur Schlüssel mit dem Präfix `SENTENZA_` gelangen in das Bündel; `envPrefix` in `vite.config.ts` hält den Rest der `.env` heraus. Eine andere Backend-Adresse verlangt einen erneuten Build, keine Änderung an der geladenen Erweiterung.

## Build

```sh
pnpm --filter @sentenza/extension build
```

Der Build läuft in drei Durchläufen nach `dist`:

1. Vorgabemodus: `background/index.js` und `popup/index.js` als ES-Module, dazu `manifest.json` und `popup/index.html`.
2. `--mode content-hook`: `inject/hook.js` als eigenständige IIFE.
3. `--mode content-bridge`: `content/bridge.js` als eigenständige IIFE.

Grund für die Aufteilung: Ein Content Script läuft als klassisches Skript, ein `import` darin schlägt zur Laufzeit fehl. Rollup würde bei mehreren ES-Einstiegspunkten gemeinsam genutzte Module in eigene Bündel auslagern, sobald sich die beiden Content Scripts ein Modul teilen. Je Durchlauf genau ein IIFE-Einstiegspunkt schließt das aus.

Laden in Chrome: `chrome://extensions` öffnen, Entwicklermodus einschalten, „Entpackte Erweiterung laden" und `apps/extension/dist` wählen.

## Stand

Umgesetzt sind Manifest, Build und die Einstiegspunkte als Gerüst. Fachlichkeit folgt in den Aufgaben 16.2 bis 16.17 des Specs `backend-busuu-ingestion`: Mustererkennung der Endpunkte, Umhüllung, Brücke, Warteschlange, Anmeldung, Erneuerung, Übertragung und Popup.
