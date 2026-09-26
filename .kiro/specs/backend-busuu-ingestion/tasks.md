# Implementation Plan: backend-busuu-ingestion

## Overview

Dieser Plan setzt das Fundament von Sentenza um: ein Greenfield-Turborepo-Monorepo mit NestJS-Backend (code-first GraphQL, Prisma, PostgreSQL) und Chrome Extension (Manifest V3) als einziger Datenquelle. Das Repository enthält derzeit ausschließlich `.git`, `.kiro/` und `fixtures/busuu/`; die erste Aufgabe schafft daher die vollständige Toolchain.

Die Reihenfolge folgt der Abhängigkeitsrichtung des Designs: Toolchain → geteilte Domänentypen → Datenbankschicht → Bootstrap mit Konfiguration, Fehlerbehandlung und Protokollierung → Anmeldung → Payload-Schemata → Rohaufnahme → Normalisierung (Katalog, dann Lernstand) → Round-Trip-Prüfmittel → Abfrage-API → Extension → Struktur- und Meta-Tests. Jede Aufgabe endet in integriertem, lauffähigem Code; es entsteht kein Modul, das erst später angeschlossen wird.

Der Aufgabengraph ist bis Aufgabe 6 auf Aufgaben-Ebene geführt, weil dieser Teil abgeschlossen ist. Ab der offenen Restarbeit — 6.12, 6.13 und alles von Aufgabe 7 an — ist er auf Unteraufgaben-Ebene aufgelöst, damit sichtbar wird, welche Arbeit tatsächlich gleichzeitig laufen kann. Sechs der neun verbleibenden Spuren beginnen dadurch in derselben Welle.

Tests gehören zur jeweiligen Aufgabe. Die 45 Korrektheitseigenschaften des Designs werden je Eigenschaft als genau ein eigenschaftsbasierter Test mit `fast-check` (`numRuns: 100`) umgesetzt und sind unmittelbar bei der Implementierung eingeplant, die sie prüft. Struktur- und Meta-Tests, die erst sinnvoll sind, wenn alle Bestandteile existieren, bilden die letzte Arbeitsaufgabe.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "status": "abgeschlossen",
      "tasks": ["1"],
      "rationale": "Ohne pnpm-Workspace, Turborepo, geteilte ESLint- und TypeScript-Config, Prettier-Ignores und Vitest-Basis kann kein anderes Paket gebaut, geprüft oder getestet werden."
    },
    {
      "wave": 2,
      "status": "abgeschlossen",
      "tasks": ["2"],
      "rationale": "@sentenza/domain ist die einzige Deklarationsstelle der Enumerationen und der Fehlercodes. Datenbankschema, Backend, Payload-Schemata und Extension hängen alle daran."
    },
    {
      "wave": 3,
      "status": "abgeschlossen",
      "tasks": ["3"],
      "rationale": "Datenbankschicht: Prisma-Schema, eingecheckte Migration, PrismaService, Testdatenbank. Aufgabe 7 stand ursprünglich ebenfalls in dieser Welle; sie ist jetzt auf Unteraufgaben-Ebene in den Wellen 6 bis 8 eingeplant."
    },
    {
      "wave": 4,
      "status": "abgeschlossen",
      "tasks": ["4"],
      "rationale": "Bootstrap, Konfiguration, Apollo, Fehlerformatierer, Protokollierung und Health setzen die Datenbankschicht voraus und sind Grundlage jedes Resolvers."
    },
    {
      "wave": 5,
      "status": "abgeschlossen",
      "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11"],
      "rationale": "Google-Tokenprüfung, Freigabeliste, Tokenausstellung, Erneuerung und der global registrierte Guard. Offen bleiben aus Aufgabe 6 nur 6.12 (AuthResolver samt Modellen) und 6.13 (Ablauf- und Fehlerfalltests des Auth_Service); beide stehen in Welle 6."
    },
    {
      "wave": 6,
      "tasks": ["6.12", "6.13", "7.1", "8.1", "10.1", "12.1", "13.1", "16.1", "17.3"],
      "rationale": "Neun Unteraufgaben ohne jede Abhängigkeit untereinander, in sieben verschiedenen Verzeichnissen: AuthResolver (src/auth/auth.resolver.ts, models/), Auth_Service-Tests (src/auth/__tests__/), Payload-Schemata (packages/busuu-contracts/src/), RawPayload-Repository samt Größenprüfung (src/ingestion/raw-payload.repository.ts), Ableitung der Zielsprache (src/busuu/normalizer/), Vergleichsfunktion (test/support/normalized-state.ts), Katalog-Abfrage mit Sortierung (src/catalog/), Extension-Gerüst mit Manifest und Vite-Build (apps/extension/) und der Fixture-Integritätstest. Berührungspunkt: 6.12 und 13.1 registrieren je ein Modul, 6.12 in auth.module.ts, 13.1 in app.module.ts."
    },
    {
      "wave": 7,
      "tasks": ["7.2", "7.4", "7.6", "8.2", "10.2", "12.2", "12.3", "12.4", "13.2", "13.3", "16.2", "16.3", "16.8"],
      "rationale": "Die drei reinen Funktionen in busuu-contracts (Auflösung der Übersetzungsschlüssel, CEFR-Abbildung, unbekannte Feldpfade) liegen in getrennten Dateien und hängen nur am Barrel aus 7.1. Parallel dazu: Drei-Transaktionen-Ablauf der Ingestion, Serializer und fast-check-Generatoren (beide nur auf die Schemata aus 7.1 und das Prisma-Modell angewiesen, nicht auf die Normalisierer), Filter und DataLoader der Abfrage-API sowie Chrome-Attrappen, Mustererkennung der Endpunkte und Warteschlange der Extension."
    },
    {
      "wave": 8,
      "tasks": ["7.3", "7.5", "7.7", "8.3", "10.3", "11.1", "12.7", "13.4", "13.7", "13.10", "16.4", "16.5", "16.7", "16.9", "16.16"],
      "rationale": "Erste Welle, in der beide Normalisierer beginnen können: der Katalog-Normalisierer braucht 10.1 und die drei Funktionen aus Welle 7, der Lernstands-Normalisierer nur die Schemata und den Ingestion-Pfad. Dazu die Einreichungs-Mutation, die Tests der reinen Funktionen, Lernstandsauflösung und Filtertests der Abfrage-API sowie Umhüllung von fetch/XHR, Content-Script-Brücke, Warteschlangentest und Popup der Extension."
    },
    {
      "wave": 9,
      "tasks": [
        "8.4",
        "8.7",
        "8.8",
        "8.10",
        "8.11",
        "8.12",
        "8.13",
        "10.4",
        "10.5",
        "10.6",
        "10.9",
        "11.2",
        "11.7",
        "11.8",
        "13.5",
        "13.6",
        "13.8",
        "16.6"
      ],
      "rationale": "Breiteste Welle des Plans: achtzehn Unteraufgaben in je eigenen Dateien. Die Rohdaten-Abfragen folgen der Mutation, weil beide denselben Resolver bearbeiten. Kennzeichnung verschwundener Entitäten und Verwerfungsregeln folgen dem jeweiligen Normalisierer, weil sie dieselbe Datei erweitern. Alle übrigen Einträge sind eigenschaftsbasierte Tests, die einander nicht berühren."
    },
    {
      "wave": 10,
      "tasks": ["8.5", "8.6", "8.9", "10.7", "10.8", "10.10", "11.3", "11.5", "12.5", "13.9", "15.1", "17.4"],
      "rationale": "Round-Trip des Katalogs ist ab hier prüfbar, weil Normalisierer, Serializer, Generatoren und Vergleichsfunktion vollständig sind. Die Abfrage über die Kontogrenze braucht zusätzlich die Rohdaten-Abfragen aus Welle 9. GraphQL Code Generator läuft erst jetzt, weil schema.gql mit 6.12, 8.3, 8.4 und 13.2 vollständig ist."
    },
    {
      "wave": 11,
      "tasks": ["11.4", "11.6", "11.9", "11.10", "12.6", "15.2"],
      "rationale": "Die Tests des Lernstands-Normalisierers, die die Anlage unbekannter Themen voraussetzen, dazu der Round-Trip der Lernstands-Payloads und der fetch-Client auf Grundlage der generierten Operationen."
    },
    {
      "wave": 12,
      "tasks": ["15.3", "16.10"],
      "rationale": "Client-Tests und Anmeldung im Service Worker. Die Anmeldung ist die erste Unteraufgabe der Extension, die den typisierten Client tatsächlich braucht."
    },
    {
      "wave": 13,
      "tasks": ["16.11", "16.13"],
      "rationale": "Vorab-Erneuerung und Übertragung mit Wiederholkette. Beide setzen die Anmeldung voraus; sie liegen in getrennten Dateien (background/auth.ts gegenüber background/upload.ts), teilen aber den Zustand aus 16.8."
    },
    {
      "wave": 14,
      "tasks": ["16.12", "16.14", "16.15", "16.17"],
      "rationale": "Erneuerungsschwelle, Zeichengleichheit der Übertragung, Absicherung gegen Beendigung des Service Workers und die Kantenfalltests der Extension. Vier voneinander unabhängige Dateien."
    },
    {
      "wave": 15,
      "tasks": ["17.1", "17.2"],
      "rationale": "Meta- und Strukturtests prüfen Aussagen über den gesamten Bestand: Testablage, Abgleich der Exportlisten, Wildcard-Berechtigungen im Manifest, Unerreichbarkeit des Serializers, keine erneute Enumerationsdeklaration unter apps/**. Sie sind erst aussagekräftig, wenn keine Datei mehr hinzukommt."
    }
  ]
}
```

Die Prüfpunkte 5, 9, 14 und 18 sind bewusst nicht Teil des Graphen: sie führen keinen eigenen Code hinzu, sondern sichern den Stand der jeweils abgeschlossenen Wellen ab. Auf die Wellen abgebildet: Prüfpunkt 9 (Anmeldung und Rohaufnahme tragen) liegt nach Welle 10, wenn alle Eigenschaften 7 bis 13 und 35 bis 39 grün sind; Prüfpunkt 14 (Backend vollständig) nach Welle 11; Prüfpunkt 18 nach Welle 15.

### Wie die Wellen zu lesen sind

Ab Welle 6 ist der Graph auf Unteraufgaben-Ebene aufgelöst. Eine Welle ist eine Barriere: alles in ihr darf gleichzeitig bearbeitet werden, die nächste Welle beginnt erst, wenn die vorige vollständig ist. Jede Unteraufgabe steht in der frühesten Welle, in der ihre sachlichen Voraussetzungen erfüllt sind. Zwei Unteraufgaben stehen nur dann in derselben Welle, wenn sie weder eine Vorbedingung teilen noch dieselbe Datei bearbeiten.

### Parallele Spuren

Geschweifte Klammern bedeuten „gleichzeitig bearbeitbar", der Pfeil bedeutet „erst danach".

- **Spur A — `busuu-contracts`.** `7.1 → {7.2, 7.4, 7.6} → {7.3, 7.5, 7.7}`. Ab Welle 6, ohne Voraussetzung.
- **Spur B — Ingestion.** `8.1 → 8.2 → 8.3 → 8.4 → {8.5 … 8.13}`. Ab Welle 6, ohne Voraussetzung. Längste Zwangskette des Plans.
- **Spur C — Katalog-Normalisierer.** `10.1 → 10.3 → 10.6 → {10.2, 10.4, 10.5, 10.7, 10.8, 10.9, 10.10}`. Ab Welle 6; 10.3 wartet auf A (7.2, 7.4, 7.6) und B (8.2).
- **Spur D — Lernstands-Normalisierer.** `11.1 → 11.2 → 11.3 → {11.4 … 11.10}`. Ab Welle 8; wartet auf A (7.1) und B (8.2), ausdrücklich **nicht** auf C.
- **Spur E — Round-Trip-Prüfmittel.** `{12.1, 12.3, 12.4} → {12.2, 12.7} → 12.5 → 12.6`. Ab Welle 6; nur 12.5 wartet auf C, nur 12.6 auf D.
- **Spur F — Abfrage-API.** `13.1 → 13.2 → 13.3 → 13.4 → {13.5 … 13.10}`. Ab Welle 6, ohne Voraussetzung; nur 13.9 wartet auf B (8.4).
- **Spur G — `api-client`.** `15.1 → 15.2 → 15.3`. Ab Welle 10; wartet auf ein vollständiges `schema.gql` aus 6.12, 8.3, 8.4 und 13.2.
- **Spur H — Extension.** `16.1 → {16.2, 16.3, 16.8} → {16.4, 16.5, 16.7, 16.9, 16.16} → 16.10 → {16.11, 16.13} → {16.12, 16.14, 16.15, 16.17}`. Ab Welle 6, ohne Voraussetzung; erst ab 16.10 auf G.
- **Spur I — Struktur- und Meta-Tests.** 17.3 vorab, 17.4 nach B und F, `{17.1, 17.2}` zuletzt. Ab Welle 6.

Sechs der neun Spuren beginnen in derselben Welle. Das ist der wesentliche Unterschied zur Aufgaben-Granularität.

### Was die Auflösung an Parallelität freilegt

Drei Abhängigkeiten, die der Graph auf Aufgaben-Ebene behauptet hat, bestehen bei genauerem Hinsehen nicht:

- **Die Extension wartete auf das gesamte Backend.** Tatsächlich hängen nur 16.10, 16.13 und die davon abhängigen Tests am typisierten Client. Gerüst, Mustererkennung, Umhüllung von `fetch` und `XMLHttpRequest`, Content-Script-Brücke, Warteschlange und Popup — zehn der siebzehn Unteraufgaben — brauchen aus dem Backend nichts als die Fehlercode-Enumeration und können ab Welle 6 laufen.
- **Die Abfrage-API wartete auf die Normalisierung.** Sie liest ausschließlich Prisma-Modelle. Ihre Tests säen den Bestand direkt über Prisma, nicht über den Ingestion-Pfad. 13.1 bis 13.8 und 13.10 sind von den Aufgaben 8, 10 und 11 unabhängig; nur 13.9 braucht die Rohdaten-Abfragen für die dritte Kontogrenze.
- **Die Round-Trip-Prüfmittel warteten auf den vollständigen normalisierten Bestand.** Das gilt für 12.5 und 12.6, nicht für die Bausteine: Vergleichsfunktion (Prisma-Modell), Serializer (Prisma-Modell und Schemata) und Generatoren (Schemata) sind vier bis sechs Wellen früher baubar.

### Was sich nicht parallelisieren lässt

Fünf Reihenfolgen sind zwingend, weil die Unteraufgaben dieselbe Datei erweitern:

- 8.3 vor 8.4 — beide bearbeiten `ingestion.resolver.ts`.
- 10.3 vor 10.6 — die Kennzeichnung verschwundener Entitäten ist ein Nachlauf innerhalb von `catalog.normalizer.ts`.
- 11.1 vor 11.2 vor 11.3 — Kernablauf, Verwerfungsregeln und Anlage unbekannter Themen liegen alle in `progress.normalizer.ts`.
- 13.1 vor 13.2 — die Filter erweitern Service und Modelle der Abfrage.
- 16.10 vor 16.11 — Anmeldung und Vorab-Erneuerung liegen beide in `background/auth.ts`.

Hinzu kommt die Kette aus vier Zwängen, die den kritischen Pfad bildet: `8.1 → 8.2 → 8.3 → 8.4 → 15.1 → 15.2 → 16.10 → 16.11 → 16.12`. Neun Wellen, und keine davon lässt sich durch zusätzliche Bearbeiter verkürzen.

### Gemeinsam berührte Dateien innerhalb einer Welle

Vier Stellen, an denen gleichzeitig bearbeitete Unteraufgaben sich begegnen. Sie sind kein Grund, die Parallelität aufzugeben, verlangen aber, dass die frühere Unteraufgabe die Stelle vorbereitet:

- **Barrel von `busuu-contracts`.** 7.2, 7.4 und 7.6 exportieren gleichzeitig. 7.1 legt die Exportzeilen aller drei Module bereits an.
- **Zuordnung Payload-Art zu Normalisierer.** 10.3 und 11.1 hängen sich in denselben Verteiler ein. 8.2 legt ihn als typisierte Abbildung mit beiden Einträgen an, die zunächst auf einen werfenden Platzhalter zeigen; jede der beiden Unteraufgaben ersetzt genau einen Eintrag.
- **`shared/messages.ts` der Extension.** 16.5 und 16.7 senden und empfangen dieselben Nachrichtentypen. 16.3 deklariert sie mit, nicht 16.7.
- **`app.module.ts`.** 13.1 (Welle 6) und 8.3 (Welle 8) registrieren je ein Modul, liegen aber in verschiedenen Wellen. Innerhalb einer Welle gibt es keine zwei Registrierungen.

### Grenzen der Parallelität

- **Parallel bearbeiten heißt nicht parallel ausführen.** Die Backend-Testprojekte laufen mit `pool: 'forks'` und `singleFork: true` gegen eine einzige Testdatenbank. Die achtzehn Unteraufgaben der Welle 9 lassen sich gleichzeitig schreiben; ihre Laufzeit addiert sich trotzdem.
- **Jede neue Operation berührt Eigenschaft 29.** 6.12, 8.3, 8.4 und 13.1 erweitern `schema.gql` um Felder von `Query` beziehungsweise `Mutation`. Der Test aus 6.11 zählt diese Felder auf; jede dieser Unteraufgaben muss ihn erneut laufen lassen, auch wenn sie ihn nicht bearbeitet.
- **Empfehlung zum kritischen Pfad.** Aufgabe 15.1 vermischt zwei Dinge: das Paketgerüst mit den `.graphql`-Operationsdateien und den Lauf des Code Generators. Nur der zweite Teil braucht ein vollständiges `schema.gql`. Wird 15.1 aufgeteilt, wandern 15.2, 16.10 und 16.13 je zwei Wellen nach vorn und der kritische Pfad verkürzt sich von neun auf sieben Wellen. Der Plan lässt 15.1 unverändert, weil die Aufteilung eine Abweichung von der Aufgabenliste des Designs wäre; sie ist eine bewusste Option, kein Versehen.

## Tasks

- [x] 1. Monorepo-Grundgerüst und Toolchain
  - [x] 1.1 pnpm-Workspace und Turborepo-Wurzel anlegen
    - `package.json` (privat, `packageManager`, Skripte `format`, `lint`, `check-types`, `build`, `test`, `postinstall`), `pnpm-workspace.yaml` mit `apps/*` und `packages/*`
    - `turbo.json` mit dem im Design festgelegten Aufgabengraphen: `format` ohne Cache, `build` mit `dependsOn: ["^build"]` und `outputs: ["dist/**", "schema.gql"]`, `lint`, `check-types` und `test` jeweils mit `dependsOn: ["^build"]`
    - Jede paketübergreifende Abhängigkeit ausschließlich als `workspace:*`
    - _Requirements: 1.1, 1.2, 1.13_

  - [x] 1.2 Geteilte Konfigurationspakete erstellen
    - `packages/typescript-config/` (`@sentenza/typescript-config`) mit `base.json` im Strict-Modus sowie Varianten für NestJS und Extension
    - `packages/eslint-config/` (`@sentenza/eslint-config`) als Flat-Config mit `eslint-plugin-simple-import-sort` und der Regel `no-restricted-imports` für `test/support/**` aus `src/**`
    - Wurzel-`eslint.config.mjs`, die die geteilte Config einbindet und `fixtures/**`, `**/dist/**` sowie `apps/backend/schema.gql` ignoriert
    - _Requirements: 1.3, 1.7_

  - [x] 1.3 Prettier einrichten und Fixtures vor Formatierung schützen
    - `.prettierrc` (einfache Anführungszeichen, abschließende Kommata) und `.prettierignore` mit `fixtures/`, `apps/backend/schema.gql`, `apps/backend/prisma/migrations/`, `**/dist/`
    - _Requirements: 1.2, 10.8_

  - [x] 1.4 `docker-compose.yml` mit beiden PostgreSQL-Diensten schreiben
    - Dienst `postgres` auf Port 5432 und Dienst `postgres-test` auf Port 5433, je mit benanntem Volume und Healthcheck, sodass Verbindungen innerhalb von 60 Sekunden angenommen werden und der Bestand einen Neustart übersteht
    - _Requirements: 1.5_

  - [x] 1.5 `.env.example` mit allen gelesenen Variablen anlegen
    - Alle im Design tabellierten Variablen mit Platzhalterwerten, ohne echten Zugangsdatenwert
    - _Requirements: 1.8_

  - [x] 1.6 Geteilte Vitest-Basiskonfiguration einrichten
    - Ausführung als `vitest run` ohne Beobachtungsmodus, Testdateien nach dem Muster `**/__tests__/*.test.ts`, Reporter mit Ausgabe von Testdatei, Testname und Abweichung zwischen erwartetem und beobachtetem Wert, `fast-check` als Abhängigkeit
    - _Requirements: 10.1, 10.2, 10.11_

  - [x] 1.7 Startkette im `README.md` dokumentieren
    - Genau fünf Einzelbefehle vom frischen Klon bis zur antwortenden GraphQL_API, wie im Design festgelegt
    - _Requirements: 1.11_

- [x] 2. Geteilte Domänentypen in `@sentenza/domain`
  - [x] 2.1 Enumerationen und Domänentypen deklarieren
    - `packages/domain/src/` mit `PayloadKind`, `ProcessingState`, `SubmissionSource`, `CefrLevel`, `TargetLanguage` als einzige Deklarationsstelle, dazu Barrel-Export
    - _Requirements: 1.4_

  - [x] 2.2 Fehlercode-Enumeration und Fehlerklasse deklarieren
    - `packages/domain/src/error-code.ts` mit `SentenzaErrorCode` (`UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, `UPSTREAM_UNAVAILABLE`, `INTERNAL_SERVER_ERROR`) und `SentenzaError` mit optionalem `details`
    - _Requirements: 9.1_

  - [x] 2.3 Grenzfalltests für die geteilten Typen schreiben
    - `packages/domain/src/__tests__/error-code.test.ts`: Vollständigkeit der Enumeration, `SentenzaError` mit und ohne `details`
    - _Requirements: 9.1, 10.10_

- [x] 3. Datenbankschicht und Testdatenbank
  - [x] 3.1 `schema.prisma` vollständig schreiben
    - `apps/backend/prisma/schema.prisma` mit den Modellen `UserAccount`, `RefreshToken`, `RawPayload`, `GrammarCategory`, `GrammarTopic`, `GrammarProgress`, allen Enumerationen, den im Design festgelegten eindeutigen Schlüsseln (`[language, busuuId]`, `[userAccountId, grammarTopicId]`, `tokenHash`) und Indizes; `contentHash` ausdrücklich nicht eindeutig, `content` als `@db.Text`
    - _Requirements: 1.10, 3.7, 3.12_

  - [x] 3.2 Erste Migration erzeugen und `postinstall` verdrahten
    - Eingecheckte Migration unter `apps/backend/prisma/migrations/`, Skripte `db:generate`, `db:migrate:dev`, `db:migrate:deploy`; Wurzel-`postinstall` ruft `db:generate` ohne erreichbare Datenbank auf
    - _Requirements: 1.6, 1.10_

  - [x] 3.3 `PrismaService` und Re-Export der generierten Typen
    - `apps/backend/src/prisma/prisma.service.ts` und `prisma.types.ts`; kein Konsument importiert aus dem generierten Pfad
    - _Requirements: 1.10_

  - [x] 3.4 Testdatenbank-Infrastruktur aufbauen
    - `apps/backend/test/global-setup.ts`: Abbruch, wenn die verwendete Verbindungszeichenkette nicht `TEST_DATABASE_URL` oder gleich `DATABASE_URL` ist, danach `prisma migrate deploy`
    - Reset-Helfer mit `TRUNCATE … RESTART IDENTITY CASCADE` über die aus der Prisma-DMMF abgeleiteten Tabellen; eigene Vitest-Projektkonfiguration mit `pool: 'forks'` und `singleFork: true`
    - _Requirements: 10.7_

  - [x] 3.5 Migrationstreue prüfen
    - `apps/backend/prisma/__tests__/migrations.test.ts`: `migrate deploy` auf leerer Datenbank, danach muss `migrate diff` gegen `schema.prisma` leer sein
    - _Requirements: 1.10_

- [x] 4. Bootstrap, Konfiguration, Fehlerbehandlung, Protokollierung, Health
  - [x] 4.1 Zod-validierte Konfiguration implementieren
    - `apps/backend/src/config/configuration.ts` mit `SentenzaConfig` und `loadConfig`, einschließlich Bereichsprüfung für `ACCESS_TOKEN_TTL_MINUTES` (5–60, Vorgabe 15) und Vorgabewerten für `INGESTION_MAX_PAYLOAD_BYTES`, `REFRESH_TOKEN_TTL_DAYS`, `DB_STARTUP_TIMEOUT_MS`, `DEFAULT_TARGET_LANGUAGE`
    - _Requirements: 1.8, 1.12, 2.6_

  - [x] 4.2 Property 40 als eigenschaftsbasierten Test umsetzen
    - **Property 40: Eine unvollständige Konfiguration verhindert den Start** — für jede nicht-leere Teilmenge der benötigten Variablen bricht die Prüfung ab und benennt jeden fehlenden Namen
    - **Validates: Requirements 1.12**
    - _Requirements: 1.12_

  - [x] 4.3 `main.ts` mit Startprüfungen implementieren
    - `loadConfig` vor jedem Portöffnen, `waitForDatabase` mit Frist aus `DB_STARTUP_TIMEOUT_MS`, Abbruch mit Nennung der fehlenden Variablen beziehungsweise der fehlgeschlagenen Datenbankverbindung und `process.exit(1)`
    - _Requirements: 1.12_

  - [x] 4.4 `AppModule` mit Apollo code-first aufsetzen
    - GraphQL-Modul mit `autoSchemaFile` auf `apps/backend/schema.gql`, `registerEnumType` für alle aus `@sentenza/domain` importierten Enumerationen, Port aus `PORT`
    - _Requirements: 1.9, 1.4, 7.8_

  - [x] 4.5 Apollo-Fehlerformatierer implementieren
    - `apps/backend/src/common/format-error.ts`: `SentenzaError` bleibt erhalten, jede unzugeordnete Ursache wird `INTERNAL_SERVER_ERROR`, Antwort trägt die Korrelationskennung und keinen Aufrufstapel, keine Datenbankmeldung, keinen Dateipfad, keinen Hostnamen; `includeStacktraceInErrorResponses` deaktiviert; Eingabeverstöße mit Feldpfad über `class-validator`
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 4.6 Property 35 als eigenschaftsbasierten Test umsetzen
    - **Property 35: Jede Fehlerantwort trägt genau einen Code und keine internen Details**
    - **Validates: Requirements 9.1, 9.3**
    - _Requirements: 9.1, 9.3_

  - [x] 4.7 Strukturierte Protokollierung mit Redaction implementieren
    - `apps/backend/src/common/logger.ts`: JSON-Einträge mit `timestamp`, `component`, `correlationId`, `level`, `message` und optional `rawPayloadId`, `step`; Redaction als Serializer-Hook für `idToken`, `accessToken`, `refreshToken`, `authorization`, `jwtSecret`, `content`, `body`; anstelle des Inhalts nur `contentHash` und `contentBytes`
    - _Requirements: 9.3, 9.5_

  - [x] 4.8 Property 38 als eigenschaftsbasierten Test umsetzen
    - **Property 38: Geheimnisse und Payload-Inhalte erscheinen in keinem Protokolleintrag**
    - **Validates: Requirements 9.5**
    - _Requirements: 9.5_

  - [x] 4.9 Health-Endpunkt mit Terminus implementieren
    - `apps/backend/src/health/`: `GET /health` mit `SELECT 1` über Prisma und Zeitlimit von 5 Sekunden, Antwort mit Gesamtzustand und Ergebnis je geprüfter Abhängigkeit
    - _Requirements: 9.7, 9.8_

  - [x] 4.10 Kantenfalltest für nicht erreichbare Datenbank schreiben
    - Health-Antwort meldet Gesamtzustand `error` und benennt `database` als nicht erreichbar
    - _Requirements: 9.9_

- [x] 5. Prüfpunkt — Fundament steht
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Anmeldung mit Google und Absicherung der Schnittstelle
  - [x] 6.1 `GoogleTokenVerifier` implementieren
    - `apps/backend/src/auth/google-token.verifier.ts`: Schlüsselauswahl über `kid` mit `jwks-rsa`, JWKS-Abruf mit Zeitlimit 5 Sekunden und kurzlebigem Cache, Prüfung von Signatur, `iss`, `aud`, `exp` mit `clockTolerance: 60` und `email_verified === true`; Zeitüberschreitung oder Netzfehler ergibt `UPSTREAM_UNAVAILABLE`, jeder Tokendefekt `UNAUTHENTICATED`
    - _Requirements: 2.1, 2.2, 2.3, 2.13_

  - [x] 6.2 Property 24 als eigenschaftsbasierten Test umsetzen
    - **Property 24: Ein Google-ID-Token wird genau bei vollständiger Gültigkeit angenommen** — Tokens aus einem im Test erzeugten RSA-Schlüsselpaar (`jose`), JWKS-Client als Attrappe, kein Netzaufruf
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - _Requirements: 2.1, 2.2, 2.3, 10.9_

  - [x] 6.3 Freigabeliste implementieren
    - Vergleich nach `trim()` und `toLowerCase()` auf beiden Seiten; Treffer ist Voraussetzung für Anmeldung und für jede Erneuerung, Verstoß ergibt `FORBIDDEN` ohne Kontoanlage und ohne Tokenausstellung
    - _Requirements: 2.4_

  - [x] 6.4 Property 25 als eigenschaftsbasierten Test umsetzen
    - **Property 25: Die Freigabeliste entscheidet über den Zugang**
    - **Validates: Requirements 2.4**
    - _Requirements: 2.4_

  - [x] 6.5 `AuthService.signInWithGoogle` mit Kontoanlage und Tokenausstellung implementieren
    - `upsert` auf `googleSubject` mit Fortschreiben der E-Mail-Adresse; Access-Token als HS256-JWT mit `sub`, `iss: 'sentenza'`, Gültigkeit aus der Konfiguration; Refresh-Token als opakes Zufallstoken (32 Byte, base64url), in `RefreshToken` ausschließlich als SHA-256-Hash mit `expiresAt` (30 Tage) und nullbarem `revokedAt`; Rückgabe beider Token samt Ablaufzeitpunkten
    - _Requirements: 2.5, 2.6, 2.7, 2.8_

  - [x] 6.6 Property 26 als eigenschaftsbasierten Test umsetzen
    - **Property 26: Ausgestellte Tokens tragen die konfigurierten Gültigkeitsdauern**
    - **Validates: Requirements 2.5, 2.6, 2.9**
    - _Requirements: 2.5, 2.6, 2.9_

  - [x] 6.7 Property 27 als eigenschaftsbasierten Test umsetzen
    - **Property 27: Je Google-Subject-Kennung existiert genau ein Benutzerkonto**
    - **Validates: Requirements 2.7, 2.8**
    - _Requirements: 2.7, 2.8_

  - [x] 6.8 Erneuerung und Widerruf implementieren
    - `refreshAccessToken` prüft Hash-Treffer, `expiresAt`, `revokedAt` und Kontozuordnung sowie erneut die Freigabeliste; keine Rotation des Refresh-Tokens; `revokeRefreshToken` setzt `revokedAt`; jeder Defekt ergibt `UNAUTHENTICATED`
    - _Requirements: 2.9, 2.14_

  - [x] 6.9 Property 28 als eigenschaftsbasierten Test umsetzen
    - **Property 28: Ein nicht vorlagefähiges Refresh-Token führt zu keiner Erneuerung**
    - **Validates: Requirements 2.14**
    - _Requirements: 2.14_

  - [x] 6.10 `JwtStrategy`, globalen `GqlAuthGuard`, `@Public()` und `@CurrentUser()` implementieren
    - Guard global registriert, Header aus `GqlExecutionContext`, `clockTolerance: 60`, Laden des Kontos und Bereitstellung im GraphQL-Kontext; kein Service erhält eine Kontokennung aus einem Eingabefeld
    - _Requirements: 2.10, 2.11, 2.12_

  - [x] 6.11 Property 29 als eigenschaftsbasierten Test umsetzen
    - **Property 29: Jede Operation außer Anmeldung und Erneuerung ist geschützt** — Aufzählung der Felder von `Query` und `Mutation` aus dem erzeugten Schema gegen alle Tokendefekte
    - **Validates: Requirements 2.10, 2.11**
    - _Requirements: 2.10, 2.11_

  - [x] 6.12 `AuthResolver` und GraphQL-Modelle ergänzen
    - `signInWithGoogle` und `refreshAccessToken` mit `@Public()`, `AuthPayload`, `AccessTokenPayload`, Eingabetypen mit deklarierter Validierung
    - _Requirements: 2.5, 2.9, 9.2_

  - [ ] 6.13 Ablauf- und Fehlerfalltests je exportierter Funktion von Auth_Service schreiben
    - Je Funktion ein Test des erwarteten Ablaufs und einer in den Requirements beschriebenen Fehlerbedingung; ausdrücklich JWKS nicht innerhalb von 5 Sekunden; Grenzfalltest bei Funktionen ohne Fehlerbedingung
    - _Requirements: 2.13, 10.3, 10.10_

- [ ] 7. Payload-Schemata und reine Auflösungslogik in `@sentenza/busuu-contracts`
  - [ ] 7.1 Zod-Schemata beider Payload-Arten deklarieren
    - `packages/busuu-contracts/src/`: `catalogPayloadSchema`, `progressPayloadSchema`, `translationEntrySchema`, `grammarTopicSchema` mit durchgehendem `.passthrough()`; Fehlermeldung nennt Payload-Art und `issues[0].path`; Paket frei von NestJS und Prisma
    - _Requirements: 6.1, 6.2_

  - [ ] 7.2 Auflösung der Übersetzungsschlüssel implementieren
    - `resolveText(key, map): ResolvedText` je Sprache `de` und `en`: erst nicht-leeres `value`, sonst erster nicht-leerer Eintrag aus `alternative_values` in Auftretensreihenfolge, sonst der Schlüssel selbst mit `*Resolved = false` und Warnung; keine Kürzung
    - _Requirements: 4.5, 4.6, 4.7, 4.10_

  - [ ] 7.3 Property 15 als eigenschaftsbasierten Test umsetzen
    - **Property 15: Inhaltsfelder werden je Sprache regelkonform und ungekürzt aufgelöst**
    - **Validates: Requirements 4.5, 4.6, 4.7, 4.10**
    - _Requirements: 4.5, 4.6, 4.7, 4.10_

  - [ ] 7.4 CEFR-Abbildung implementieren
    - `mapCefrLevel`: getrimmt und kleingeschrieben gegen `a1|a2|b1|b2|c1`, sonst `UNBEKANNT` mit unverändertem Originalwert und Warnung
    - _Requirements: 4.8, 4.9_

  - [ ] 7.5 Property 16 als eigenschaftsbasierten Test umsetzen
    - **Property 16: Die CEFR-Abbildung ist total** — einschließlich fehlendem Feld und leerer Zeichenkette
    - **Validates: Requirements 4.8, 4.9**
    - _Requirements: 4.8, 4.9_

  - [ ] 7.6 Erkennung unbekannter Feldpfade implementieren
    - `collectUnknownPaths`: Vergleich jedes Feldpfads gegen die Menge der abgebildeten Pfade, Array-Indizes zu `[]` normalisiert, höchstens ein Eintrag je eindeutigem Pfad und Payload, kein Abbruch
    - _Requirements: 6.7_

  - [ ] 7.7 Property 6 als eigenschaftsbasierten Test umsetzen
    - **Property 6: Unbekannte Feldpfade werden vollständig und dublettenfrei protokolliert**
    - **Validates: Requirements 6.7**
    - _Requirements: 6.7_

- [ ] 8. Aufnahme und Aufbewahrung roher Payloads
  - [ ] 8.1 Eingabe- und Größenprüfung sowie `RawPayload`-Repository implementieren
    - `apps/backend/src/ingestion/raw-payload.repository.ts`; Prüfung von `payloadKind` gegen die Enumeration, nicht-leerem `content` und `Buffer.byteLength(content, 'utf8')` gegen `INGESTION_MAX_PAYLOAD_BYTES` vor jeder Persistenz; Verstoß ergibt `BAD_USER_INPUT` mit Nennung des beanstandeten Eingabewerts
    - _Requirements: 3.1, 3.8, 3.11_

  - [ ] 8.2 `IngestionService.submit` mit dem Drei-Transaktionen-Ablauf implementieren
    - Korrelationskennung erzeugen; T1 legt den Eintrag zeichengenau mit `submittedAt` (UTC), Konto, Payload-Art, `SENTENZA_EXTENSION`, `contentBytes`, SHA-256-`contentHash` ab und ist vor Beginn der Normalisierung festgeschrieben; T2 umfasst ausschließlich die Normalisierung und wird bei jedem Fehler vollständig zurückgerollt; T3 schreibt danach `VERARBEITET` mit `processedAt`, `TEILWEISE_VERARBEITET` mit Zählwerten oder `FEHLGESCHLAGEN` mit auf 2.000 Zeichen begrenzter Fehlermeldung
    - Protokolleintrag bei Fehlschlag benennt Verarbeitungsschritt, Korrelationskennung und `rawPayloadId`
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 9.4, 9.6, 9.10_

  - [ ] 8.3 Einreichungs-Mutation und `IngestionResult` ergänzen
    - `submitBusuuPayload(input: SubmitBusuuPayloadInput!): IngestionResult!` mit Rückgabe von Kennung, Verarbeitungszustand, Zählwerten und Warnungsanzahl
    - _Requirements: 3.1, 3.9_

  - [ ] 8.4 Abfragen für Rohdaten implementieren
    - `rawPayloads(filter, page)`: ausschließlich Einträge des angemeldeten Kontos, absteigend nach `submittedAt`, Filter nach Payload-Art und Verarbeitungszustand, `limit` serverseitig auf 100 begrenzt
    - `rawPayloadContent(id)`: unveränderter Inhalt samt gespeichertem `contentHash`; Eintrag eines anderen Kontos gilt als nicht vorhanden
    - _Requirements: 3.10, 3.12, 3.13, 2.15_

  - [ ] 8.5 Property 7 als eigenschaftsbasierten Test umsetzen
    - **Property 7: Einreichung und Abruf sind ein zeichengenauer Round-Trip**
    - **Validates: Requirements 3.2, 3.3, 3.13**
    - _Requirements: 3.2, 3.3, 3.13_

  - [ ] 8.6 Property 8 als eigenschaftsbasierten Test umsetzen
    - **Property 8: Die Aufbewahrung ist monoton**
    - **Validates: Requirements 3.7, 3.12**
    - _Requirements: 3.7, 3.12_

  - [ ] 8.7 Property 10 als eigenschaftsbasierten Test umsetzen
    - **Property 10: Die Größengrenze entscheidet über Annahme und Ablehnung**
    - **Validates: Requirements 3.8, 3.11**
    - _Requirements: 3.8, 3.11_

  - [ ] 8.8 Property 11 als eigenschaftsbasierten Test umsetzen
    - **Property 11: Der zurückgegebene Verarbeitungszustand entspricht dem persistierten**
    - **Validates: Requirements 3.4, 3.9**
    - _Requirements: 3.4, 3.9_

  - [ ] 8.9 Property 12 als eigenschaftsbasierten Test umsetzen
    - **Property 12: Die Auflistung der Rohdaten erfüllt Ordnung, Filter und Seitengrenze**
    - **Validates: Requirements 3.10**
    - _Requirements: 3.10_

  - [ ] 8.10 Property 9 als eigenschaftsbasierten Test umsetzen
    - **Property 9: Ein Fehlschlag ändert den normalisierten Bestand nicht und wird am erhaltenen Eintrag vermerkt**
    - **Validates: Requirements 3.5, 3.6, 9.6**
    - _Requirements: 3.5, 3.6, 9.6_

  - [ ] 8.11 Property 36 als eigenschaftsbasierten Test umsetzen
    - **Property 36: Eingabeverstöße werden mit Pfad benannt und wirken nicht**
    - **Validates: Requirements 9.2**
    - _Requirements: 9.2_

  - [ ] 8.12 Property 37 als eigenschaftsbasierten Test umsetzen
    - **Property 37: Protokolleinträge eines Ingestion-Vorgangs sind zuordenbar**
    - **Validates: Requirements 9.4**
    - _Requirements: 9.4_

  - [ ] 8.13 Property 39 als eigenschaftsbasierten Test umsetzen
    - **Property 39: Korrelationskennungen sind eindeutig und durchgehend**
    - **Validates: Requirements 9.10**
    - _Requirements: 9.10_

- [ ] 9. Prüfpunkt — Anmeldung und Rohaufnahme tragen
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Normalisierung des Grammatikkatalogs
  - [ ] 10.1 Ableitung der Zielsprache implementieren
    - Segment hinter dem letzten Unterstrich der Katalog-Kennung, ohne Beachtung der Groß- und Kleinschreibung, Abbildung auf `TargetLanguage`; kein Treffer bricht mit Nennung der Kennung ab, ohne eine Entität anzulegen oder zu ändern
    - _Requirements: 4.1, 4.16_

  - [ ] 10.2 Property 13 als eigenschaftsbasierten Test umsetzen
    - **Property 13: Die Zielsprache folgt aus der Katalog-Kennung**
    - **Validates: Requirements 4.1, 4.16**
    - _Requirements: 4.1, 4.16_

  - [ ] 10.3 `catalog.normalizer.ts` implementieren
    - Validierung des vollständigen Payloads vor dem ersten Schreibvorgang; Upserts auf `(language, busuuId)` für Kategorien und Themen mit zeichengleicher Übernahme der Kennung (1–200 Zeichen, auch UUID-basiert); Zuordnung über `structure`; Sortierpositionen nach Deduplizierung auf erstes Auftreten lückenlos ab 1; Themen nur aus `structure` als `incomplete` mit `UNBEKANNT`; Themen ohne `structure`-Referenz ohne Kategorie und ohne Sortierposition; `premium` als Wahrheitswert mit Vorgabe `false`, `access_tier` unverändert mit leerem Vorgabewert; Ablage der Übersetzungsschlüssel und der aufgelösten Texte je Sprache; Warnungen über den Logger mit Korrelationskennung
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.17, 6.1, 6.2, 6.7_

  - [ ] 10.4 Property 14 als eigenschaftsbasierten Test umsetzen
    - **Property 14: Die persistierte Entitätsmenge ist vollständig und schlüsseltreu**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.12, 4.13, 4.17**
    - _Requirements: 4.2, 4.3, 4.4, 4.12, 4.13, 4.17_

  - [ ] 10.5 Property 17 als eigenschaftsbasierten Test umsetzen
    - **Property 17: Sortierpositionen bilden je Kategorie eine lückenlose Folge ab 1**
    - **Validates: Requirements 4.11**
    - _Requirements: 4.11_

  - [ ] 10.6 Kennzeichnung verschwundener Entitäten implementieren
    - Nach allen Upserts einer Zielsprache `inCatalog = false` bei den übrigen Kategorien und Themen, ohne zu löschen und ohne Bezeichnung, Beschreibung, CEFR_Level, Sortierposition, Kategoriezuordnung oder Lernstand zu verändern; Wiederauftauchen setzt `inCatalog = true`
    - _Requirements: 4.15, 4.18_

  - [ ] 10.7 Property 18 als eigenschaftsbasierten Test umsetzen
    - **Property 18: Verschwundene Entitäten werden erhalten und gekennzeichnet**
    - **Validates: Requirements 4.15, 4.18**
    - _Requirements: 4.15, 4.18_

  - [ ] 10.8 Property 3 als eigenschaftsbasierten Test umsetzen
    - **Property 3: Idempotenz der Katalog-Normalisierung** — zweimalige Verarbeitung gegen die Testdatenbank, Vergleich aller persistierten Feldwerte und Datensatzanzahlen
    - **Validates: Requirements 4.14**
    - _Requirements: 4.14, 10.6_

  - [ ] 10.9 Property 5 als eigenschaftsbasierten Test umsetzen
    - **Property 5: Validierung vor jedem Schreibvorgang, Pfad der ersten Verletzung**
    - **Validates: Requirements 6.1, 6.2**
    - _Requirements: 6.1, 6.2_

  - [ ] 10.10 Beispieltest gegen das Katalog-Fixture schreiben
    - `fixtures/busuu/grammar-review-es.json` normalisiert vollständig: 19 Kategorien, 134 Grammatik_Themen, alle fünf bekannten CEFR_Level, korrekte Auflösung der vier Einträge mit `alternative_values`
    - _Requirements: 10.3, 10.8_

- [ ] 11. Normalisierung des Lernstands
  - [ ] 11.1 `progress.normalizer.ts` implementieren
    - Abbruch bei `status !== 'ok'` mit Nennung des abweichenden Werts; Verarbeitung der Einträge in Payload-Reihenfolge; Upsert auf `(userAccountId, grammarTopicId)` mit vollständigem Ersetzen von `strength`, `percentage` und `observedAt = ctx.submittedAt`; nicht enthaltene Themen bleiben unangetastet, auch bei leerer `data`-Liste; bei Mehrfachnennung gewinnt der letzte gültige Eintrag
    - _Requirements: 5.1, 5.2, 5.3, 5.9, 5.11, 5.12_

  - [ ] 11.2 Verwerfungsregeln und Zählwerte implementieren
    - Verwerfen bei fehlendem oder leerem `topic_id`, bei fehlendem, nicht ganzzahligem oder außerhalb 0–100 liegendem `percentage`, bei fehlendem oder nicht nicht-negativ ganzzahligem `strength`; bestehende Lernstände bleiben unverändert; Verarbeitung der übrigen Einträge läuft weiter; `TEILWEISE_VERARBEITET` mit Anzahl verworfener und persistierter Einträge
    - _Requirements: 5.5, 5.6, 5.7, 5.10_

  - [ ] 11.3 Anlage unbekannter Grammatik_Themen implementieren
    - Themensuche sprachunabhängig über die Busuu-Kennung; neu angelegtes Thema ohne Bezeichnung, mit `inCatalog = false` und `DEFAULT_TARGET_LANGUAGE`, Lernstand daran gebunden, Warnung protokolliert
    - _Requirements: 5.4_

  - [ ] 11.4 Property 19 als eigenschaftsbasierten Test umsetzen
    - **Property 19: Je Konto und Thema bleibt genau der letzte gültige Eintrag**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.11**
    - _Requirements: 5.1, 5.2, 5.3, 5.11_

  - [ ] 11.5 Property 20 als eigenschaftsbasierten Test umsetzen
    - **Property 20: Ungültige Einträge werden verworfen, gültige verarbeitet, Zählwerte stimmen**
    - **Validates: Requirements 5.5, 5.6, 5.7, 5.10**
    - _Requirements: 5.5, 5.6, 5.7, 5.10_

  - [ ] 11.6 Property 21 als eigenschaftsbasierten Test umsetzen
    - **Property 21: Unbekannte Themen-Kennungen erzeugen ein gebundenes Thema**
    - **Validates: Requirements 5.4**
    - _Requirements: 5.4_

  - [ ] 11.7 Property 22 als eigenschaftsbasierten Test umsetzen
    - **Property 22: Fehlende Einträge lassen bestehende Lernstände unberührt**
    - **Validates: Requirements 5.9**
    - _Requirements: 5.9_

  - [ ] 11.8 Property 23 als eigenschaftsbasierten Test umsetzen
    - **Property 23: Ein abweichender Status bricht ohne Wirkung ab**
    - **Validates: Requirements 5.12**
    - _Requirements: 5.12_

  - [ ] 11.9 Property 4 als eigenschaftsbasierten Test umsetzen
    - **Property 4: Idempotenz der Lernstands-Normalisierung** — zweimalige Verarbeitung mit demselben Einreichungszeitpunkt gegen die Testdatenbank
    - **Validates: Requirements 5.8**
    - _Requirements: 5.8, 10.6_

  - [ ] 11.10 Beispiel- und Fehlerfalltests je exportierter Funktion von Busuu_Normalizer schreiben
    - `fixtures/busuu/progress.json` erzeugt 8 Lernstände zu Themen des Katalog-Fixtures; je exportierter Funktion ein Test des erwarteten Ablaufs und einer beschriebenen Fehler- oder Verwerfungsbedingung, sonst ein Grenzfalltest mit leerer Eingabe
    - _Requirements: 10.3, 10.8, 10.10_

- [ ] 12. Round-Trip-Prüfmittel und Nachweis der Verlustfreiheit
  - [ ] 12.1 Vergleichsfunktion `normalizedStateEquals` implementieren
    - `apps/backend/test/support/normalized-state.ts`: Vergleich ausschließlich über fachliche Schlüssel und fachliche Feldwerte, ohne technische Kennungen, `createdAt`, `updatedAt`, `firstSeenAt`, `lastSeenInCatalogAt`
    - _Requirements: 6.8_

  - [ ] 12.2 Beispieltests für die Vergleichsfunktion in beiden Richtungen schreiben
    - Gleiche Bestände mit abweichenden technischen Kennungen gelten als gleich; ein abweichender fachlicher Feldwert ausdrücklich nicht
    - _Requirements: 6.8_

  - [ ] 12.3 `Busuu_Serializer` im Testbereich implementieren
    - `apps/backend/test/support/busuu-serializer.ts` mit `serializeCatalog` und `serializeProgress` nach den Abbildungsregeln des Designs; nur Entitäten mit `inCatalog = true`; Rekonstruktion der `translation_map` aus gespeicherten Schlüsseln und Texten, wobei ein unaufgelöstes Inhaltsfeld keinen Eintrag erzeugt; `SerializationFailure` mit fachlichem Schlüssel und Feldname lässt den Bestand unverändert; kein Nest-Provider, kein Resolver, Ausschluss von `test/**` im Build-`tsconfig`
    - _Requirements: 6.3, 6.4, 6.9, 6.10_

  - [ ] 12.4 fast-check-Generatoren für beide Payload-Arten schreiben
    - `apps/backend/test/support/arbitraries.ts`: beide Formen der Busuu-Kennungen, alle bekannten CEFR_Level in gemischter Schreibweise sowie unbekannte, leere und fehlende Werte, Übersetzungseinträge mit und ohne `value` und `alternative_values`, fehlende Schlüssel, leere Sammlungen, `structure` mit Lücken in beide Richtungen und Wiederholungen; für Lernstände Prozentwerte an den Grenzen 0 und 100, Stärke 0, unbekannte und doppelte Themen-Kennungen
    - _Requirements: 10.4_

  - [ ] 12.5 Property 1 als eigenschaftsbasierten Test umsetzen
    - **Property 1: Round-Trip-Verlustfreiheit für Katalog-Payloads** — normalisieren, serialisieren, erneut normalisieren bei gleichem Einreichungszeitpunkt; Serialisierung erfüllt das Katalog-Schema; Gegenbeispiel wird minimiert samt `seed` ausgegeben
    - **Validates: Requirements 6.3, 6.5**
    - _Requirements: 6.3, 6.5, 10.4, 10.5_

  - [ ] 12.6 Property 2 als eigenschaftsbasierten Test umsetzen
    - **Property 2: Round-Trip-Verlustfreiheit für Lernstands-Payloads**
    - **Validates: Requirements 6.4, 6.6**
    - _Requirements: 6.4, 6.6, 10.4, 10.5_

  - [ ] 12.7 Kantenfalltest für nicht abbildbare Datensätze schreiben
    - `SerializationFailure` benennt fachlichen Schlüssel und nicht abbildbares Feld, der normalisierte Bestand bleibt unverändert
    - _Requirements: 6.10_

- [ ] 13. Abfrage von Katalog und Lernstand
  - [ ] 13.1 Catalog-Modelle, Resolver und Service mit Sortierung implementieren
    - `apps/backend/src/catalog/`: `grammarCatalog(language, filter)`, Typen `GrammarCategory`, `GrammarTopic`, `GrammarProgress` wie im Design; Kategorien aufsteigend nach `busuuId`, Themen nach `sortPosition` und bei Gleichheit nach `busuuId`, Themen ohne Sortierposition zuletzt
    - _Requirements: 7.1, 7.2, 7.8_

  - [ ] 13.2 Filter implementieren
    - Liste von CEFR_Level-Werten, Lernstands-Filter `WITH_PROGRESS`/`WITHOUT_PROGRESS`/`ANY` mit Vorgabe `ANY`, `includeRemovedFromCatalog` mit Vorgabe `false`; fehlende oder nicht unterstützte Zielsprache ergibt `BAD_USER_INPUT`; leeres Ergebnis ergibt eine leere Liste ohne Fehler
    - _Requirements: 7.5, 7.6, 7.9, 7.10, 7.11_

  - [ ] 13.3 DataLoader je Auflösungsebene implementieren
    - `loaders/topics-by-category.loader.ts` und `loaders/progress-by-topic.loader.ts`, je Request erzeugt, Bündelung über `in`-Listen, `filterHash` als stabile Serialisierung der Filterargumente, `userAccountId` fest aus dem Kontext des Access-Tokens
    - _Requirements: 7.7_

  - [ ] 13.4 Lernstand und Kennzeichnung ungeübter Themen auflösen
    - `progress` ausschließlich aus dem Bestand des angemeldeten Kontos, `untrained = true` ohne Lernstand-Wert, Thema bleibt im Ergebnis
    - _Requirements: 7.3, 7.4_

  - [ ] 13.5 Property 31 als eigenschaftsbasierten Test umsetzen
    - **Property 31: Die Katalogabfrage ist ordnungs- und feldtreu**
    - **Validates: Requirements 7.1, 7.2**
    - _Requirements: 7.1, 7.2_

  - [ ] 13.6 Property 32 als eigenschaftsbasierten Test umsetzen
    - **Property 32: Ungeübte Themen bleiben im Ergebnis**
    - **Validates: Requirements 7.4**
    - _Requirements: 7.4_

  - [ ] 13.7 Property 33 als eigenschaftsbasierten Test umsetzen
    - **Property 33: Filter schneiden genau die durch das Prädikat bestimmte Teilmenge aus**
    - **Validates: Requirements 7.5, 7.6, 7.11**
    - _Requirements: 7.5, 7.6, 7.11_

  - [ ] 13.8 Property 34 als eigenschaftsbasierten Test umsetzen
    - **Property 34: Die Anzahl der Datenbankabfragen ist von der Ergebnisgröße unabhängig** — Zählung über ein Prisma-Middleware- oder Ereignis-Protokoll
    - **Validates: Requirements 7.7**
    - _Requirements: 7.7_

  - [ ] 13.9 Property 30 als eigenschaftsbasierten Test umsetzen
    - **Property 30: Keine Abfrage überschreitet die Kontogrenze** — über Katalog-, Lernstands- und Rohdaten-Abfragen zweier Konten
    - **Validates: Requirements 2.12, 2.15, 7.3**
    - _Requirements: 2.12, 2.15, 7.3_

  - [ ] 13.10 Kantenfalltests der Abfrage schreiben
    - Fehlende und nicht unterstützte Zielsprache, leeres Ergebnis bei gesetzten Filtern
    - _Requirements: 7.9, 7.10_

- [ ] 14. Prüfpunkt — Backend ist vollständig
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Typisierter GraphQL-Client in `@sentenza/api-client`
  - [ ] 15.1 Operationsdateien und Code-Generator einrichten
    - `packages/api-client/`: `.graphql`-Operationen für `signInWithGoogle`, `refreshAccessToken`, `submitBusuuPayload`, `rawPayloads`, `grammarCatalog`; GraphQL Code Generator mit `apps/backend/schema.gql` als Quelle; generierte Dateien als generiert gekennzeichnet und von Prettier sowie ESLint ausgenommen
    - _Requirements: 1.1, 1.4_

  - [ ] 15.2 Schlanken `fetch`-Client mit Fehlercode-Auswertung implementieren
    - Auswertung von `extensions.code` gegen `SentenzaErrorCode` aus `@sentenza/domain`, ohne Apollo Client
    - _Requirements: 9.1_

  - [ ] 15.3 Unit-Tests für den Client schreiben
    - Erfolgsfall sowie Zuordnung jedes Fehlercodes; keine Netzverbindung
    - _Requirements: 9.1, 10.9_

- [ ] 16. Chrome Extension
  - [ ] 16.1 Manifest V3 und Vite-Build aufsetzen
    - `apps/extension/manifest.json` mit `host_permissions` ausschließlich für die Busuu-Domänen und die konfigurierte Backend-Adresse, `permissions` `storage`, `identity`, `alarms`, Service Worker als Modul, beide Content-Script-Einträge (`world: MAIN` und `world: ISOLATED`, je `document_start`), Popup; Vite-Build in `dist`
    - _Requirements: 8.1, 8.5_

  - [ ] 16.2 Chrome-Attrappen und Netzabstinenz im Test-Setup einrichten
    - `apps/extension/test/support/chrome-mock.ts` für `chrome.identity`, `chrome.storage.local` mit tatsächlicher Persistenz je Test, `chrome.runtime`, `chrome.alarms`; `globalThis.fetch` als werfende Attrappe, `undici`-`MockAgent` mit `disableNetConnect()`, `vi.useFakeTimers()` für die Wartezeiten
    - _Requirements: 10.9_

  - [ ] 16.3 Mustererkennung der Endpunkte implementieren
    - `src/shared/endpoints.ts` mit `ENDPOINT_PATTERNS` und `classifyUrl`; kein Treffer bedeutet verwerfen, nicht ablegen, nicht übertragen
    - _Requirements: 8.6, 8.13, 8.14_

  - [ ] 16.4 Property 41 als eigenschaftsbasierten Test umsetzen
    - **Property 41: Erfasst und übertragen wird genau das, was einem Muster entspricht**
    - **Validates: Requirements 8.6, 8.13, 8.14**
    - _Requirements: 8.6, 8.13, 8.14_

  - [ ] 16.5 Umhüllung von `fetch` und `XMLHttpRequest` implementieren
    - `src/inject/hook.ts`: unveränderte Rückgabe an die Seite, Inhalt aus `response.clone().text()` beziehungsweise `responseText` im `loadend`-Listener, Weitergabe über `queueMicrotask`/`setTimeout(…, 0)` mit höchstens 50 ms Verzögerung, jeder Ausleseversuch in `try/catch`
    - _Requirements: 8.5, 8.7_

  - [ ] 16.6 Property 42 als eigenschaftsbasierten Test umsetzen
    - **Property 42: Die Umhüllung verändert die Antwort an die Seite nicht**
    - **Validates: Requirements 8.7**
    - _Requirements: 8.7_

  - [ ] 16.7 Content-Script-Brücke implementieren
    - `src/content/bridge.ts`: Prüfung von `event.origin`, Nonce und `type`, Zuordnung der Payload-Art über `classifyUrl`, Weitergabe per `chrome.runtime.sendMessage`; Nachrichtentypen in `src/shared/messages.ts`
    - _Requirements: 8.6_

  - [ ] 16.8 Zustand und Warteschlange in `chrome.storage.local` implementieren
    - `ExtensionState` und `QueuedCapture` wie im Design; höchstens 50 Einträge, Verdrängung des ältesten mit Erhöhung von `droppedCount`, Abarbeitung in Erfassungsreihenfolge, Entfernen nach Erfolg mit Fortschreiben von `lastSuccessfulUploadAt`
    - _Requirements: 8.9, 8.11, 8.17_

  - [ ] 16.9 Property 44 als eigenschaftsbasierten Test umsetzen
    - **Property 44: Die Warteschlange hält die jüngsten Erfassungen in Reihenfolge**
    - **Validates: Requirements 8.9, 8.11, 8.17**
    - _Requirements: 8.9, 8.11, 8.17_

  - [ ] 16.10 Anmeldung im Service Worker implementieren
    - `chrome.identity.launchWebAuthFlow` mit `response_type=id_token`, `nonce` und Client-Kennung, Zeitlimit 120 Sekunden; Übergabe an `signInWithGoogle`; Ablage von Access- und Refresh-Token, Status auf angemeldet, Google-ID-Token nicht dauerhaft gespeichert; Abbruch, Zeitüberschreitung oder Ablehnung führt zu keinem gespeicherten Token, Status nicht angemeldet und Fehlermeldung im Popup
    - _Requirements: 8.2, 8.3, 8.15_

  - [ ] 16.11 Vorab-Erneuerung und Umgang mit fehlgeschlagener Erneuerung implementieren
    - Erneuerung bei Restgültigkeit unter 60 Sekunden, anschließende Übertragung mit dem neuen Token; bei Fehlschlag oder fehlendem Refresh-Token beide Token entfernen, Status nicht angemeldet, Popup verlangt neue Anmeldung, weitere Inhalte nur noch zwischenspeichern
    - _Requirements: 8.4, 8.16_

  - [ ] 16.12 Property 45 als eigenschaftsbasierten Test umsetzen
    - **Property 45: Die Erneuerungsschwelle entscheidet über eine Vorab-Erneuerung**
    - **Validates: Requirements 8.4**
    - _Requirements: 8.4_

  - [ ] 16.13 Übertragung mit Wiederholkette implementieren
    - Unveränderte Übertragung über `submitBusuuPayload` mit zugeordneter Payload-Art; Wiederholung nach 1, 4 und 16 Sekunden bei Netzfehler, `UPSTREAM_UNAVAILABLE` und `INTERNAL_SERVER_ERROR`; keine Wiederholung bei `BAD_USER_INPUT`; `UNAUTHENTICATED` und `FORBIDDEN` verwerfen die Token; nach der dritten erfolglosen Wiederholung bleibt der Eintrag zwischengespeichert und `lastError` erscheint im Popup
    - _Requirements: 8.8, 8.10_

  - [ ] 16.14 Property 43 als eigenschaftsbasierten Test umsetzen
    - **Property 43: Der übertragene Inhalt ist zeichengleich zum erfassten**
    - **Validates: Requirements 8.8**
    - _Requirements: 8.8_

  - [ ] 16.15 Absicherung gegen Beendigung des Service Workers implementieren
    - Wiederkehrender `chrome.alarms`-Wecker und Abarbeitung der Warteschlange bei jedem Start des Service Workers, sofern `nextAttemptAt` erreicht ist; der gesamte Zustand liegt ausschließlich in `chrome.storage.local`
    - _Requirements: 8.9, 8.10_

  - [ ] 16.16 Popup implementieren
    - Anzeige von Anmeldestatus, Zeitpunkt der letzten erfolgreichen Übertragung, Anzahl zwischengespeicherter Inhalte, letzter Fehlermeldung und Hinweis auf verworfene Inhalte; Platzhalter für fehlende Werte; Lesen ausschließlich aus `chrome.storage.local`, kein Netzaufruf; barrierefreie Auszeichnung der Statusbereiche
    - _Requirements: 8.12, 8.17_

  - [ ] 16.17 Kantenfalltests der Extension schreiben
    - Abbruch und Zeitüberschreitung der Anmeldung, fehlgeschlagene Erneuerung, vollständige Wiederholkette 1/4/16 Sekunden mit Zeitattrappen, Popup mit und ohne Werte
    - _Requirements: 8.10, 8.12, 8.15, 8.16_

- [ ] 17. Struktur- und Meta-Tests
  - [ ] 17.1 Meta-Tests über Testablage und Testabdeckung schreiben
    - Jede Testdatei liegt in `__tests__` neben dem geprüften Quelltext und heißt `<name>.test.ts`; Abgleich der Exportlisten von Busuu_Normalizer und Auth_Service gegen die vorhandenen Testdateien
    - _Requirements: 10.2, 10.3, 10.10_

  - [ ] 17.2 Strukturtests über das Repository schreiben
    - Keine Wildcard-Host-Berechtigung im Manifest; kein Modul unter `apps/backend/src/**` importiert den Serializer und `schema.gql` enthält kein Serializer-Feld; keine erneute Deklaration einer geteilten Enumeration unter `apps/**`; Schlüsselmenge von `.env.example` gleich der des Konfigurationsschemas
    - _Requirements: 1.4, 1.8, 6.9, 8.1_

  - [ ] 17.3 Integritätstest der Fixtures schreiben
    - Byte-Größe und SHA-256 beider Dateien unter `fixtures/busuu/` gegen im Test hinterlegte Werte, abgeleitet aus dem zum Zeitpunkt der Umsetzung vorliegenden Dateizustand; siehe den Vorbehalt unter `## Notes`
    - _Requirements: 10.8_

  - [ ] 17.4 Integrationstest des Hochfahrens schreiben
    - Nest-Anwendung gegen die Testdatenbank: Port geöffnet, `schema.gql` erzeugt, Health-Endpunkt antwortet mit dem Ergebnis der Datenbankprüfung
    - _Requirements: 1.9, 9.7, 9.8_

- [ ] 18. Abschluss-Prüfpunkt — vollständiger Durchlauf der Qualitätskette
  - `format`, `lint`, `check-types`, `build`, `test` in dieser Reihenfolge über alle Workspace-Pakete; ein Fehlschlag endet mit einem von Null verschiedenen Exit-Code und benennt Paket, Aufgabe, Testdatei und Abweichung
  - Ensure all tests pass, ask the user if questions arise.

## Notes

### Was außerhalb der Codebasis liegt und vom Nutzer selbst zu tun ist

Die folgenden Schritte kann kein Coding-Agent ausführen. Sie sind Voraussetzung dafür, dass die Kette Ende zu Ende mit echten Daten läuft; der gesamte Code einschließlich aller Tests ist ohne sie umsetzbar und prüfbar:

1. OAuth-Client bei Google anlegen (Typ Chrome-Erweiterung beziehungsweise Webanwendung) und die Client-Kennung als `GOOGLE_CLIENT_ID` und `SENTENZA_GOOGLE_CLIENT_ID` in die lokale `.env` eintragen.
2. Die eigene Google-E-Mail-Adresse in `AUTH_ALLOWED_EMAILS` setzen. Ohne diese Liste erhält kein Konto Zugang; mit einer zu weiten Liste könnte jedes Google-Konto in die Datenbank schreiben.
3. Ein Signaturgeheimnis für `JWT_SECRET` erzeugen und in `.env` eintragen. `.env` gehört nicht ins Repository, `.env.example` enthält ausschließlich Platzhalter.
4. Die gebaute Extension entpackt in Chrome laden und die Anmeldung im Popup einmal auslösen.
5. Den Busuu-Grammatiktrainer im Browser öffnen, damit echte Antworten der beiden Endpunkte anfallen und übertragen werden.

### Vorbehalt zu den Fixtures

Die beiden Dateien unter `fixtures/busuu/` sind derzeit **nicht mehr byte-identisch zum Busuu-Original**: ein Format-on-Save des Editors hat sie umformatiert. Der JSON-Inhalt ist dabei unverändert geblieben, Größe und Inhalts-Hash sind es nicht.

Empfehlung, bevor Aufgabe 17.3 die Werte festschreibt: beide Antworten erneut aus dem Browser abgreifen und unangetastet ablegen. Die Byte-Kodierung ist nicht rekonstruierbar — Busuu liefert Nicht-ASCII-Zeichen und Schrägstriche escaped aus, eine Wiederverdichtung über `JSON.stringify` trifft den ursprünglichen Stand nicht. Solange das offen ist, leitet Aufgabe 17.3 die Hashwerte aus dem dann vorliegenden Dateizustand ab. Damit schützt der Test vor künftiger unbemerkter Umformatierung, belegt aber **nicht** das echte Busuu-Byteformat. Dieser Punkt bleibt **nachzuziehen**, sobald frische Payloads vorliegen: Fixtures ersetzen, Werte in 17.3 neu setzen, Requirement 10.8 damit erst vollständig erfüllt.

Der Schutz gegen erneute Umformatierung greift ab Aufgabe 1.3: `fixtures/` steht in `.prettierignore` und in den ESLint-Ignores.

### Laufzeit der Testsuite

Von den 45 Korrektheitseigenschaften laufen 32 gegen die Testdatenbank, jeweils mit mindestens 100 Durchläufen und einem Reset je Durchlauf. Die Aufgabe `test` wird dadurch deutlich langsamer als eine reine Unit-Test-Suite. Gegenmaßnahmen sind bereits eingeplant: `TRUNCATE` statt Neumigration, bewusst kleine erzeugte Payloads (0–5 Kategorien, 0–8 Themen), reine Eigenschaften ohne Datenbank. Eine Aufteilung in ein schnelles und ein langsames Vitest-Projekt kann später nötig werden; sie ist nicht Teil dieses Plans.

### Optionale Unteraufgaben

Mit `*` markierte Unteraufgaben sind Test- und Prüfaufgaben. Sie sind nicht erforderlich, damit die Kette vom Browser bis zur Abfrage läuft, und können für einen schnellen ersten Durchstich übersprungen werden. Requirement 10 gilt dann nicht als erfüllt, und die Verlustfreiheit der Normalisierung nach Requirement 6 ist ohne die Eigenschaften 1, 2, 5 und 6 nicht belegt. Kein Kernbestandteil ist als optional markiert, insbesondere nicht der Serializer und die Generatoren aus Aufgabe 12 — sie sind Voraussetzung der Round-Trip-Eigenschaften und daher verbindlich, sobald diese umgesetzt werden.

### Reihenfolge bei Abschluss jeder Aufgabe

`format` → `lint` → `check-types` → `build` → `test`. Keine Aufgabe gilt als abgeschlossen, solange einer dieser fünf Schritte fehlschlägt.

### Sonstiges

- Generierte Artefakte werden nie handisch bearbeitet: `apps/backend/schema.gql` (code-first aus Decorators), der Prisma-Client, die Ausgaben von GraphQL Code Generator in `packages/api-client`.
- Die Prüfpunkte 5, 9, 14 und 18 sind nicht Teil des Aufgabengraphen, weil sie keinen eigenen Code hinzufügen.
- `schema.prisma` bleibt die einzige Quelle der Datenbankstruktur; jede Änderung läuft über eine eingecheckte Migration.
