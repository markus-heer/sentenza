# Design Document

## Overview

Dieses Design beschreibt das Fundament von Sentenza: ein Greenfield-Turborepo-Monorepo mit einem lokal betriebenen NestJS-Backend (code-first GraphQL, Prisma, PostgreSQL) und einer Chrome Extension (Manifest V3) als einziger Datenquelle. Die Extension fängt die Antworten des Busuu-Grammatiktrainers im Browser ab und reicht sie unverändert beim Backend ein. Das Backend legt jeden Payload zuerst roh und dauerhaft ab, normalisiert ihn anschließend in ein Datenmodell aus Grammatik-Kategorien, Grammatik-Themen und Lernstand und stellt beides über GraphQL zur Abfrage bereit. Die Anmeldung läuft über Google OAuth 2.0 / OIDC direkt, ohne Auth0; das Backend prüft Google-ID-Tokens gegen die von Google veröffentlichten JWKS und stellt eigene Access- und Refresh-Tokens aus.

Leitende Entwurfsgedanken, die sich aus der Eigenart der Datenquelle ergeben:

- **Roh vor normalisiert.** Es gibt keine offizielle Busuu-API und keine Formatgarantie. Der rohe Payload ist die einzige belastbare Wahrheit und wird deshalb zeichengenau und dauerhaft aufbewahrt, bevor die Normalisierung beginnt. Jede Modelländerung lässt sich anschließend ohne erneuten Abruf bei Busuu nachvollziehen.
- **Validieren, nicht raten.** Jeder Payload wird vor dem ersten Schreibvorgang gegen ein deklariertes Schema geprüft. Unbekannte Feldpfade werden protokolliert statt stillschweigend verworfen.
- **Idempotenz über fachliche Schlüssel.** Busuu-Payloads sind Momentaufnahmen. Alle Schreibvorgänge der Normalisierung sind Upserts auf fachlichen Schlüsseln (Busuu-Kennung je Zielsprache, Benutzerkonto je Grammatik-Thema).
- **Verlustfreiheit ist beweispflichtig.** Ein ausschließlich für Prüfzwecke existierender Serializer erlaubt eigenschaftsbasierte Round-Trip-Tests über die Normalisierung.
- **Einzelnutzer, aber sauber mandantengetrennt.** Jede Entität mit Nutzerdaten hängt an genau einem Benutzerkonto; alle Abfragen filtern auf das Konto des Access-Tokens. Zusätzlich begrenzt eine Freigabeliste von Google-E-Mail-Adressen den Zugang.

**Nicht Teil dieses Designs:** Flutter-App und Schreibübungen, Vokabeltrainer nach dem 5-Kammer-Prinzip, Anthropic-/Claude-Integration, Live-Infrastruktur und Deployment. Kein Anki-Import.

### Abdeckung der Requirements

| Requirement                             | Tragende Abschnitte dieses Designs                                 |
| --------------------------------------- | ------------------------------------------------------------------ |
| 1 Monorepo-Grundgerüst                  | Architecture (Workspace-Struktur, Aufgabengraph, Startkette)       |
| 2 Anmeldung mit Google                  | Components (Auth-Modul), Data Models (UserAccount, RefreshToken)   |
| 3 Aufnahme roher Payloads               | Components (Ingestion-Modul), Data Models (RawPayload)             |
| 4 Normalisierung Katalog                | Components (Busuu_Normalizer), Data Models (GrammarCategory/Topic) |
| 5 Normalisierung Lernstand              | Components (Busuu_Normalizer), Data Models (GrammarProgress)       |
| 6 Verlustfreiheit                       | Components (Busuu_Serializer), Correctness Properties, Testing     |
| 7 Abfrage Katalog und Lernstand         | Components (Abfragemodul, DataLoader), Data Models (GraphQL-Typen) |
| 8 Chrome Extension                      | Components (Sentenza_Extension)                                    |
| 9 Fehlerbehandlung, Nachvollziehbarkeit | Error Handling                                                     |
| 10 Testabdeckung                        | Testing Strategy                                                   |

## Architecture

### Datenfluss vom Browser bis zur Abfrage

```mermaid
flowchart LR
  subgraph BR["Chrome"]
    PAGE["Busuu-Seite<br/>(Seitenkontext)"]
    HOOK["injiziertes Skript<br/>world: MAIN, document_start<br/>umhüllt fetch + XMLHttpRequest"]
    CS["Content-Script<br/>world: ISOLATED (Brücke)"]
    SW["Service Worker<br/>Warteschlange, Anmeldung, Upload"]
    STORE[("chrome.storage.local<br/>Token, Warteschlange, Status")]
    POPUP["Popup<br/>Statusanzeige"]
  end

  subgraph BE["Sentenza_Backend (NestJS)"]
    GQL["GraphQL_API<br/>Apollo, code-first"]
    GUARD["GqlAuthGuard<br/>passport-jwt"]
    AUTH["Auth_Service<br/>Google-JWKS, eigene Tokens"]
    ING["Ingestion_Service"]
    NORM["Busuu_Normalizer"]
    QRY["Catalog-Resolver<br/>+ DataLoader"]
    HEALTH["Health-Endpunkt"]
  end

  DB[("PostgreSQL<br/>Raw_Payload_Store +<br/>normalisiertes Modell")]
  GOOGLE(["Google JWKS / OAuth"])

  PAGE -- "fetch / XHR" --> HOOK
  HOOK -- "window.postMessage (nonce)" --> CS
  HOOK -- "unveränderte Antwort" --> PAGE
  CS -- "chrome.runtime.sendMessage" --> SW
  SW <--> STORE
  POPUP -- "liest" --> STORE
  SW -- "launchWebAuthFlow" --> GOOGLE
  SW -- "signInWithGoogle / refreshAccessToken" --> GQL
  SW -- "submitBusuuPayload" --> GQL

  GQL --> GUARD
  GQL --> AUTH
  AUTH -- "JWKS, 5 s Timeout" --> GOOGLE
  GQL --> ING
  ING -- "1. Rohablage (eigene Transaktion)" --> DB
  ING -- "2. Normalisierung" --> NORM
  NORM -- "3. Upserts (eine Transaktion)" --> DB
  ING -- "4. Verarbeitungszustand" --> DB
  GQL --> QRY --> DB
  HEALTH --> DB
```

Die Reihenfolge der vier Schritte im Ingestion-Pfad ist bindend: Die Rohablage ist bestätigt abgeschlossen, bevor die Normalisierung beginnt (Requirement 3.2). Der Verarbeitungszustand wird nach dem Ende der Normalisierungstransaktion geschrieben, damit ein Rollback der Normalisierung den Zustand `FEHLGESCHLAGEN` nicht mitnimmt (siehe Error Handling).

### Workspace-Struktur

```text
sentenza/
├─ package.json                     # Root: pnpm-Workspace, Turborepo, Prettier, postinstall
├─ pnpm-workspace.yaml
├─ turbo.json
├─ .prettierrc
├─ .prettierignore                  # schützt fixtures/ vor Formatierung
├─ eslint.config.mjs                # Root-Flat-Config, ignores: fixtures/, **/dist/, generated
├─ .env.example
├─ docker-compose.yml               # postgres (5432) + postgres-test (5433)
├─ fixtures/
│  └─ busuu/
│     ├─ progress.json              # Lernstands-Payload, 8 Einträge
│     └─ grammar-review-es.json     # Katalog-Payload, 19 Kategorien, 134 Themen, 306 Übersetzungseinträge
├─ apps/
│  ├─ backend/                      # @sentenza/backend — NestJS
│  │  ├─ prisma/
│  │  │  ├─ schema.prisma           # einzige Quelle der Datenbankstruktur
│  │  │  └─ migrations/             # eingecheckte Prisma-Migrationen
│  │  ├─ schema.gql                 # generiert (code-first), nie handisch bearbeiten
│  │  ├─ src/
│  │  │  ├─ main.ts                 # Startprüfungen, Bootstrap
│  │  │  ├─ app.module.ts
│  │  │  ├─ config/                 # Zod-validierte Konfiguration
│  │  │  ├─ prisma/                 # PrismaService + prisma.types.ts (Re-Export)
│  │  │  ├─ auth/                   # auth.module|resolver|service|guard|strategy
│  │  │  ├─ ingestion/              # ingestion.module|resolver|service
│  │  │  ├─ busuu/                  # normalizer, serializer (test-only), schemas-Anbindung
│  │  │  ├─ catalog/                # catalog.module|resolver|service + loaders
│  │  │  ├─ health/                 # Terminus
│  │  │  └─ common/                 # Fehlerformatierung, Logging, Redaction
│  │  └─ test/                      # globalSetup, Datenbank-Helfer, Fixture-Loader
│  └─ extension/                    # @sentenza/extension — Manifest V3, Vite-Build
│     ├─ manifest.json
│     └─ src/
│        ├─ inject/hook.ts          # world: MAIN, umhüllt fetch/XHR
│        ├─ content/bridge.ts       # world: ISOLATED
│        ├─ background/             # Service Worker: queue, auth, upload
│        ├─ popup/                  # Statusanzeige
│        └─ shared/                 # Nachrichtentypen, Endpunkt-Muster, Storage-Zugriff
└─ packages/
   ├─ domain/                       # @sentenza/domain — geteilte Domänentypen und Enumerationen
   ├─ busuu-contracts/              # @sentenza/busuu-contracts — Zod-Schemata der beiden Payload-Arten
   ├─ api-client/                   # @sentenza/api-client — typisierte GraphQL-Operationen (Codegen)
   ├─ eslint-config/                # @sentenza/eslint-config — geteilte Flat-Config
   └─ typescript-config/            # @sentenza/typescript-config — geteilte tsconfig-Basis (strict)
```

Paketabhängigkeiten, ausschließlich über `workspace:*` (Requirement 1.1, 1.3, 1.4):

```mermaid
flowchart TD
  TSC["@sentenza/typescript-config"]
  ESL["@sentenza/eslint-config"]
  DOM["@sentenza/domain"]
  CON["@sentenza/busuu-contracts"]
  API["@sentenza/api-client"]
  BE["@sentenza/backend"]
  EX["@sentenza/extension"]

  DOM --> CON
  DOM --> API
  DOM --> BE
  DOM --> EX
  CON --> BE
  API --> EX
  TSC -.-> DOM & CON & API & BE & EX
  ESL -.-> DOM & CON & API & BE & EX
```

- `@sentenza/domain` enthält jede Enumeration und jeden Domänentyp, den mehr als eine Anwendung braucht: `PayloadKind`, `ProcessingState`, `SubmissionSource`, `CefrLevel`, `TargetLanguage`, `SentenzaErrorCode`. Keine Anwendung deklariert diese erneut (Requirement 1.4, 9.1).
- `@sentenza/busuu-contracts` enthält die Zod-Schemata der Katalog- und Lernstands-Payloads und die daraus abgeleiteten Eingabetypen. Das Paket ist frei von NestJS und Prisma, damit Normalizer, Serializer und Testgeneratoren dieselbe Schemadefinition benutzen.
- `@sentenza/api-client` enthält die `.graphql`-Operationsdateien und die daraus von GraphQL Code Generator erzeugten typisierten Dokumente. Quelle ist `apps/backend/schema.gql`. Die Extension nutzt einen schlanken `fetch`-Client statt Apollo Client — im MV3-Service-Worker gibt es keinen Cache-Bedarf und keinen DOM (Entwurfsentscheidung).

> **Entwurfsentscheidung:** Der Normalizer liegt im Backend, nicht in einem geteilten Paket, weil er Prisma-Schreibvorgänge ausführt. Nur die reinen Schemata und die reine Auflösungslogik der Übersetzungsschlüssel sind in `busuu-contracts` ausgelagert, damit sie ohne Datenbank testbar sind.

### Turborepo-Aufgabengraph

```mermaid
flowchart LR
  F["format"]
  B["build (^build)"]
  L["lint (^build)"]
  T["check-types (^build)"]
  TE["test (^build)"]
  PI["postinstall: prisma generate"]

  PI --> B
  B --> L
  B --> T
  B --> TE
```

```jsonc
// turbo.json (Auszug)
{
  "tasks": {
    "format": { "cache": false },
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", "schema.gql"] },
    "lint": { "dependsOn": ["^build"] },
    "check-types": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] },
  },
}
```

Der Präfix `^` bindet eine Aufgabe an die `build`-Aufgabe der Pakete, von denen das Paket abhängt. Damit laufen `build`, `check-types` und `test` eines Pakets erst, nachdem alle Abhängigkeiten gebaut sind (Requirement 1.2). Turborepo bricht die Kette mit einem von Null verschiedenen Exit-Code ab und benennt Paket und Aufgabe (Requirement 1.13). Reihenfolge bei Abschluss einer Aufgabe bleibt: `format` → `lint` → `check-types` → `build` → `test`.

`postinstall` im Root ruft `pnpm --filter @sentenza/backend db:generate` auf, also `prisma generate`. Das erfordert keine erreichbare Datenbank (Requirement 1.6).

### Schutz der Fixtures vor Formatierung

Das Katalog-Fixture ist bereits zweimal unbemerkt von einem Format-on-Save pretty-printed worden — zuletzt während der Erstellung dieses Designs. Die Fixtures müssen byte-identisch bleiben: Requirement 10.8 verlangt **unveränderte** Beispielpayloads, und die Round-Trip-Tests prüfen ihre Größe und ihren Inhalts-Hash. Eine Umformatierung ändert zwar nicht die JSON-Semantik, verfälscht aber Größe und Inhalts-Hash und entwertet die Fixtures als Beleg für das echte Busuu-Format. Der Byte-Bestand ist nicht rekonstruierbar, sobald er einmal überschrieben ist: eine Wiederverdichtung über `JSON.stringify` trifft die ursprüngliche Kodierung nicht, weil Busuu Nicht-ASCII-Zeichen und Schrägstriche escaped ausliefert.

Maßnahmen:

```gitignore
# .prettierignore
fixtures/
apps/backend/schema.gql
apps/backend/prisma/migrations/
**/dist/
```

```js
// eslint.config.mjs (Auszug)
export default [
  {
    ignores: ['fixtures/**', '**/dist/**', 'apps/backend/schema.gql'],
  } /* ... */,
];
```

Zusätzlich prüft ein Test die Byte-Größe und den SHA-256-Hash beider Fixtures gegen fest hinterlegte Werte, sodass eine unbemerkte Umformatierung die Aufgabe `test` rot macht (Entwurfsentscheidung, Absicherung von Requirement 10.8).

### Lokale Startkette

Fünf Einzelbefehle aus einem frisch geklonten Repository (Requirement 1.11):

```text
1  cp .env.example .env
2  docker compose up -d postgres postgres-test
3  pnpm install
4  pnpm --filter @sentenza/backend db:migrate:deploy
5  pnpm --filter @sentenza/backend start:dev
```

Schritt 3 generiert über `postinstall` den Prisma-Client. Schritt 5 startet Nest, erzeugt `apps/backend/schema.gql` und öffnet den über `PORT` konfigurierten Port (Requirement 1.9).

## Components and Interfaces

### Konfiguration und Bootstrap

`src/config/configuration.ts` liest `process.env` und validiert es mit einem Zod-Schema. Fehlt eine Variable oder ist ein Wert unzulässig (zum Beispiel `ACCESS_TOKEN_TTL_MINUTES` außerhalb 5–60), bricht der Start ab, bevor Nest einen Port öffnet.

```ts
export interface SentenzaConfig {
  port: number;
  databaseUrl: string;
  google: {
    clientId: string;
    issuer: string;
    jwksUri: string;
    jwksTimeoutMs: number;
  };
  auth: {
    allowedEmails: string[];
    jwtSecret: string;
    accessTokenTtlMinutes: number;
    refreshTokenTtlDays: number;
  };
  ingestion: { maxPayloadBytes: number; defaultTargetLanguage: TargetLanguage };
  startup: { databaseTimeoutMs: number };
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadConfig(env: NodeJS.ProcessEnv): SentenzaConfig; // wirft ConfigValidationError
```

`main.ts`:

```ts
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env); // Requirement 1.12: fehlende Variable → Abbruch
  await waitForDatabase(config.databaseUrl, config.startup.databaseTimeoutMs); // 60 s Frist
  const app = await NestFactory.create(AppModule);
  await app.listen(config.port);
}
bootstrap().catch((error) => {
  logStartupFailure(error); // benennt Variable bzw. Datenbankverbindung
  process.exit(1);
});
```

### Auth-Modul

Dateien: `auth.module.ts`, `auth.resolver.ts`, `auth.service.ts`, `google-token.verifier.ts`, `jwt.strategy.ts`, `gql-auth.guard.ts`, `models/`.

```ts
// auth.service.ts
export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export class AuthService {
  signInWithGoogle(idToken: string): Promise<AuthTokens>; // R2.1–2.8
  refreshAccessToken(refreshToken: string): Promise<AccessTokenResult>; // R2.9, 2.14
  revokeRefreshToken(refreshToken: string): Promise<void>; // Entwurfsergänzung, siehe unten
}

// google-token.verifier.ts
export class GoogleTokenVerifier {
  verify(idToken: string): Promise<GoogleIdentity>; // { subject, email, emailVerified }
}
```

**Prüfung des Google-ID-Tokens** (Requirement 2.1–2.3, 2.13). `jwks-rsa` liefert den Schlüssel anhand des `kid` aus dem Token-Header; `requestAgentOptions`/`timeout` begrenzen den JWKS-Abruf auf 5 Sekunden, ein Cache mit kurzer Lebensdauer verhindert einen Abruf je Anmeldung. Anschließend prüft `jsonwebtoken.verify` Signatur, `iss` gegen `GOOGLE_ISSUER`, `aud` gegen `GOOGLE_CLIENT_ID` und `exp` mit `clockTolerance: 60`. `email_verified === true` wird gesondert geprüft. Ein Timeout oder Netzfehler beim JWKS-Abruf wird als `UPSTREAM_UNAVAILABLE` gemeldet und ausdrücklich nicht als `UNAUTHENTICATED`, weil er keine Aussage über das Token trifft.

**Freigabeliste** (Requirement 2.4). `AUTH_ALLOWED_EMAILS` ist eine kommagetrennte Liste. Der Vergleich erfolgt nach `trim()` und `toLowerCase()` auf beiden Seiten. Ein Treffer ist Voraussetzung sowohl für die Anmeldung als auch für jede Erneuerung (Requirement 2.9), damit ein nachträgliches Entfernen aus der Liste spätestens beim nächsten Erneuern wirkt.

**Benutzerkonto** (Requirement 2.7, 2.8). Ein `upsert` auf `googleSubject` legt das Konto beim ersten Mal an und setzt bei jeder weiteren Anmeldung die E-Mail-Adresse auf den Wert aus dem Token. Damit ist kein zweites Konto für dieselbe Google-Subject-Kennung möglich.

**Access-Token.** JWT, HS256, Signatur mit `JWT_SECRET`, Claims `sub` (interne Konto-Kennung), `iss: 'sentenza'`, `iat`, `exp`. Gültigkeitsdauer aus `ACCESS_TOKEN_TTL_MINUTES`, zulässig 5–60, Vorgabe 15 (Requirement 2.6). Prüfung über `passport-jwt` in `JwtStrategy`, `clockTolerance: 60` (Requirement 2.11).

**Refresh-Token und Widerruf** (Requirement 2.5, 2.9, 2.14). Entwurfsentscheidung: Das Refresh-Token ist **kein JWT**, sondern ein opakes Zufallstoken aus 32 Byte (`crypto.randomBytes(32)`, base64url). In der Tabelle `RefreshToken` wird ausschließlich der SHA-256-Hash des Tokens gespeichert, zusammen mit `userAccountId`, `expiresAt` (30 Tage) und dem nullbaren `revokedAt`.

Begründung: Requirement 2.14 verlangt vier unterscheidbare Ablehnungsgründe — nicht von Auth_Service ausgestellt, abgelaufen, widerrufen, keinem Konto zuordenbar. Ein zustandsloses JWT kann „widerrufen" nicht beantworten, ohne dass ohnehin eine Datenbanktabelle hinzukommt. Mit einem opaken Token ist die Tabelle die Wahrheit: kein Datensatz zum Hash ⇒ nicht ausgestellt, `expiresAt` in der Vergangenheit ⇒ abgelaufen, `revokedAt` gesetzt ⇒ widerrufen, fehlendes Konto ⇒ nicht zuordenbar. Zusätzlich liegt im Speicher der Extension dann kein selbsttragendes Langzeit-Token. Eine Rotation des Refresh-Tokens bei jeder Erneuerung findet **nicht** statt: Requirement 2.9 verlangt nur ein neues Access-Token, und eine Rotation würde bei einem abgebrochenen Upload im MV3-Service-Worker zu verlorenen Anmeldungen führen (Entwurfsentscheidung).

**Guard und Request-Kontext** (Requirement 2.10, 2.12). `GqlAuthGuard` erweitert `AuthGuard('jwt')` und liest den Header aus `GqlExecutionContext`. Die Anmelde- und die Erneuerungs-Mutation tragen den Dekorator `@Public()`; der Guard ist global registriert, sodass jede neue Operation standardmäßig geschützt ist. Der Guard legt das geladene Benutzerkonto in den GraphQL-Kontext; Resolver greifen über `@CurrentUser()` darauf zu. Kein Service-Verfahren erhält eine Konto-Kennung aus einem Eingabefeld — sie kommt immer aus dem Kontext.

```graphql
type AuthPayload {
  accessToken: String!
  accessTokenExpiresAt: DateTime!
  refreshToken: String!
  refreshTokenExpiresAt: DateTime!
}

type Mutation {
  signInWithGoogle(input: SignInWithGoogleInput!): AuthPayload!
  refreshAccessToken(input: RefreshAccessTokenInput!): AccessTokenPayload!
}
```

### Ingestion-Modul

Dateien: `ingestion.module.ts`, `ingestion.resolver.ts`, `ingestion.service.ts`, `raw-payload.repository.ts`, `models/`.

```ts
export interface SubmitBusuuPayloadInput {
  payloadKind: PayloadKind; // CATALOG | PROGRESS
  content: string;
}

export interface IngestionResult {
  rawPayloadId: string;
  processingState: ProcessingState; // VERARBEITET | TEILWEISE_VERARBEITET | FEHLGESCHLAGEN
  persistedEntryCount: number | null;
  discardedEntryCount: number | null;
  warningCount: number;
}

export class IngestionService {
  submit(user: UserAccount, input: SubmitBusuuPayloadInput): Promise<IngestionResult>;
  listRawPayloads(
    user: UserAccount,
    filter: RawPayloadFilter,
    page: PageInput,
  ): Promise<RawPayloadPage>;
  readRawPayloadContent(user: UserAccount, rawPayloadId: string): Promise<RawPayloadContent>;
}
```

Ablauf von `submit`:

1. **Eingabeprüfung** vor jeder Persistenz (Requirement 3.8, 3.11): `payloadKind` muss ein Wert der Enumeration sein, `content` darf nicht leer sein, `Buffer.byteLength(content, 'utf8')` darf `INGESTION_MAX_PAYLOAD_BYTES` (Vorgabe 10 MiB = 10.485.760) nicht überschreiten. Verstoß ⇒ `BAD_USER_INPUT`, kein Eintrag, kein Schreibvorgang.
2. **Korrelationskennung** erzeugen (`crypto.randomUUID()`), sie begleitet alle Protokolleinträge dieses Vorgangs (Requirement 9.10).
3. **Rohablage** in eigener, sofort festgeschriebener Transaktion: `content` unverändert, dazu `submittedAt` (UTC), `userAccountId`, `payloadKind`, `submissionSource: SENTENZA_EXTENSION`, `contentBytes`, `contentHash` (SHA-256, hex) und `correlationId` (Requirement 3.2, 3.3). Der Inhalt wird als `String @db.Text` gespeichert, nicht als `Json` — eine JSON-Spalte würde Feldreihenfolge und Formatierung nicht zeichengenau erhalten.
4. **Normalisierung** in einer einzigen Prisma-Transaktion (Requirement 3.6, 9.6). Der Normalizer erhält einen unveränderlichen Kontext.
5. **Zustandsfortschreibung** in eigener Transaktion nach Abschluss von Schritt 4: `VERARBEITET` mit `processedAt`, `TEILWEISE_VERARBEITET` mit Anzahl verworfener und persistierter Einträge (Requirement 5.7), `FEHLGESCHLAGEN` mit gekürzter Fehlermeldung (maximal 2.000 Zeichen, Requirement 3.5).
6. **Rückgabe** von Kennung und Zustand an den Client (Requirement 3.9).

Mehrfache Einreichung desselben Inhalts ist ausdrücklich erlaubt: `contentHash` ist indiziert, aber **nicht** eindeutig; jede Einreichung erzeugt einen eigenen Eintrag (Requirement 3.7). Abgelegte Inhalte werden nie verändert, gekürzt oder gelöscht; `UPDATE`-Vorgänge auf `RawPayload` berühren ausschließlich die Zustandsfelder (Requirement 3.12).

```graphql
type Query {
  rawPayloads(filter: RawPayloadFilter, page: PageInput): RawPayloadPage!
  rawPayloadContent(id: ID!): RawPayloadContent!
}

input RawPayloadFilter {
  payloadKind: PayloadKind
  processingState: ProcessingState
}
input PageInput {
  limit: Int = 50 # maximal 100
  offset: Int = 0
}
```

`rawPayloads` sortiert absteigend nach `submittedAt`, filtert immer zusätzlich auf das Konto des Access-Tokens und begrenzt `limit` serverseitig auf 100 (Requirement 3.10). `rawPayloadContent` gibt den unveränderten Inhalt zurück und liefert den am Eintrag gespeicherten `contentHash` mit, sodass der Aufrufer die Unverändertheit selbst nachrechnen kann (Requirement 3.13). Ein Eintrag eines anderen Kontos wird als nicht vorhanden behandelt (Requirement 2.15).

### Busuu_Normalizer

Dateien: `busuu/normalizer/catalog.normalizer.ts`, `busuu/normalizer/progress.normalizer.ts`, `busuu/normalizer/translation.resolver.ts`, `busuu/normalizer/cefr.ts`, `busuu/normalizer/unknown-paths.ts`.

```ts
export interface NormalizationContext {
  readonly userAccountId: string;
  readonly rawPayloadId: string;
  readonly submittedAt: Date; // Zeitpunkt der Einreichung, nicht der Normalisierung (R5.3)
  readonly correlationId: string;
  readonly defaultTargetLanguage: TargetLanguage;
}

export interface NormalizationOutcome {
  persistedEntryCount: number;
  discardedEntryCount: number;
  warnings: NormalizationWarning[];
}

export class BusuuNormalizer {
  normalizeCatalog(
    raw: string,
    ctx: NormalizationContext,
    tx: PrismaTx,
  ): Promise<NormalizationOutcome>;
  normalizeProgress(
    raw: string,
    ctx: NormalizationContext,
    tx: PrismaTx,
  ): Promise<NormalizationOutcome>;
}
```

> **Entwurfsentscheidung:** `submittedAt` ist Teil des Kontexts und keine Ableitung aus `Date.now()`. Nur so kann die Round-Trip-Prüfung zwei Normalisierungsläufe mit identischem Beobachtungszeitpunkt fahren und ihre Ergebnisse nach Requirement 6.8 vergleichen.

**Schema-Validierung** (Requirement 6.1, 6.2). Gewählt wird **Zod**. Begründung: TypeScript-first, das Schema ist gleichzeitig die Typquelle (kein zweiter Wahrheitsort neben einer JSON-Schema-Datei), und `ZodError.issues[0].path` liefert genau den von Requirement 6.2 verlangten Pfad der ersten verletzten Stelle. Alle Objektschemata nutzen `.passthrough()`, damit unbekannte Felder für die Protokollierung nach Requirement 6.7 erhalten bleiben statt beim Parsen wegzufallen. JSON Schema mit Ajv wäre die Alternative, bräuchte aber eine separate Typableitung und liefert Pfade als JSON-Pointer, was den Requirements nicht näher kommt.

```ts
// packages/busuu-contracts
export const translationEntrySchema = z
  .object({
    value: z.string().optional(),
    alternative_values: z.array(z.string()).optional(),
  })
  .passthrough();

export const grammarTopicSchema = z
  .object({
    id: z.string().min(1).max(200),
    premium: z.boolean().optional(),
    access_tier: z.string().optional(),
    content: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        level: z.string().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export const catalogPayloadSchema = z
  .object({/* id, grammar_categories, translation_map, ... */})
  .passthrough();
export const progressPayloadSchema = z
  .object({ status: z.string(), data: z.array(progressEntrySchema) })
  .passthrough();
```

Die Validierung läuft vollständig durch, bevor der erste Datensatz geschrieben wird. Bei Verletzung wird abgebrochen, ohne den normalisierten Bestand zu berühren, und die Meldung nennt Payload-Art und Pfad.

**Zielsprache** (Requirement 4.1, 4.16). Der Sprach-Code ist das Segment hinter dem letzten Unterstrich der Katalog-Kennung, Vergleich ohne Beachtung der Groß- und Kleinschreibung. Er wird gegen die Enumeration `TargetLanguage` abgebildet; kein Treffer ⇒ Abbruch mit Nennung der Kennung, ohne Schreibvorgang.

> **Entwurfsentscheidung:** `TargetLanguage` ist eine geschlossene Enumeration mit derzeit genau einem Wert, `ES`. Requirement 4.16 und 7.9 setzen eine Menge „von Sentenza unterstützter Zielsprachen" voraus, benennen sie aber nicht. Eine Enumeration gibt dieser Menge eine prüfbare Definition; eine weitere Sprache kostet einen Enumerationswert und eine Migration, aber keine Modelländerung.

**Auflösung der Übersetzungsschlüssel** (Requirement 4.5–4.7). Für jedes Inhaltsfeld mit `str_`-Präfix wird je Sprache (`de`, `en`) aufgelöst:

```ts
export interface ResolvedText {
  key: string | null; // Übersetzungsschlüssel, für die Serialisierung benötigt
  de: string;
  en: string;
  deResolved: boolean;
  enResolved: boolean;
}

export function resolveText(key: string | undefined, map: TranslationMap): ResolvedText;
```

Regel je Sprache: erst `value`, wenn nicht-leer; sonst der erste nicht-leere Eintrag aus `alternative_values` in Reihenfolge des Auftretens (Requirement 4.7); sonst der Übersetzungsschlüssel selbst als Klartext, `*Resolved = false` und eine Warnung (Requirement 4.6). Im vorliegenden Fixture haben 4 von 306 Einträgen ein `alternative_values`-Feld und kein Eintrag einen leeren `value` — der Fallback wird deshalb ausschließlich über generierte Eingaben geprüft, nicht über das Fixture.

**CEFR-Abbildung** (Requirement 4.8, 4.9). `content.level` wird getrimmt, kleingeschrieben und gegen `a1|a2|b1|b2|c1` abgebildet. Kein Treffer, leer oder fehlend ⇒ `UNBEKANNT`, zusätzlich Ablage des unveränderten Originalwerts in `cefrLevelRaw`, Warnung, Weiterverarbeitung der übrigen Felder.

**Sortierpositionen** (Requirement 4.11). Aus `structure` wird zuerst nach erstem Auftreten dedupliziert, dann werden die verbleibenden Kennungen von 1 an in Schritten von 1 numeriert. Damit ist die Folge je Kategorie lückenlos, und bei doppelter Kennung gilt die erste Position.

> **Entwurfsentscheidung:** Requirement 4.11 lässt offen, ob eine Wiederholung eine Position verbraucht. Der Entwurf verbraucht keine, also dedupliziert er vor dem Numerieren. Begründung: Nur dann ist die Folge lückenlos, was die Sortierung in Requirement 7.1 stabil und nachvollziehbar macht. Im vorliegenden Fixture tritt keine Wiederholung auf (134 Einträge, 134 verschiedene).

**Auseinanderlaufen von `structure` und `grammar_topics`.**

- Kennung in `structure`, kein Objekt unter `grammar_topics` (Requirement 4.12): Thema wird mit der Kennung, ohne Bezeichnung und Beschreibung, mit `cefrLevel = UNBEKANNT`, mit der Sortierposition und mit `incomplete = true` angelegt; Warnung.
- Objekt unter `grammar_topics`, in keiner `structure` referenziert (Requirement 4.17): Thema wird ohne `categoryId` und ohne `sortPosition` persistiert; Warnung.

**Verschwundene Entitäten** (Requirement 4.15, 4.18). Nach dem Upsert aller im Payload enthaltenen Kategorien und Themen einer Zielsprache setzt der Normalizer bei allen übrigen Datensätzen derselben Zielsprache `inCatalog = false`. Nichts wird gelöscht, Bezeichnungen, Beschreibungen, Niveau, Sortierposition, Kategoriezuordnung und Lernstand bleiben erhalten. Ein Thema, das später wieder im Katalog erscheint, wird durch den Upsert erneut auf `inCatalog = true` gesetzt.

**Lernstand** (Requirement 5.1–5.11). Die Einträge unter `data` werden in Payload-Reihenfolge verarbeitet. Je Eintrag:

- fehlendes oder leeres `topic_id` ⇒ Eintrag verworfen, kein Thema, kein Lernstand, Weiterverarbeitung (5.10);
- `percentage` fehlend, nicht ganzzahlig oder außerhalb 0–100 ⇒ verworfen, bestehender Lernstand unverändert (5.5);
- `strength` fehlend oder keine nicht-negative ganze Zahl ⇒ verworfen, bestehender Lernstand unverändert (5.6);
- Thema unbekannt ⇒ Thema mit dieser Kennung, ohne Bezeichnung, `inCatalog = false` anlegen, Lernstand daran binden, Warnung (5.4);
- gültiger Eintrag ⇒ Upsert auf `(userAccountId, grammarTopicId)` mit vollständigem Ersetzen von `strength`, `percentage` und `observedAt = ctx.submittedAt` (5.1–5.3).

Mehrfachnennung derselben Kennung: Die Einträge werden in Reihenfolge verarbeitet, der letzte gültige gewinnt, weil jeder Upsert den vorherigen Stand vollständig ersetzt; es bleibt genau ein Datensatz je Kombination (5.11). `status !== 'ok'` bricht die Verarbeitung ab und nennt den abweichenden Wert (5.12). Themen ohne Eintrag im Payload, einschließlich leerer `data`-Liste, bleiben unangetastet (5.9).

> **Entwurfsentscheidung — Zielsprache eines Lernstands-Payloads.** Der Lernstands-Payload enthält keinen Sprachbezug, und Requirement 3.1 lässt die Einreichungs-Mutation nur Payload-Art und Inhalt annehmen. Der Normalizer sucht ein Thema deshalb zuerst allein über die Busuu-Kennung, unabhängig von der Zielsprache; muss er nach Requirement 5.4 ein Thema neu anlegen, verwendet er `DEFAULT_TARGET_LANGUAGE` (Vorgabe `es`). Begründung: Busuu-Themenkennungen sind in der Praxis global eindeutig, und Sentenza ist ein Einzelnutzer-System mit derzeit einer Lernsprache. Die Alternative — Sprache als zusätzliches Eingabefeld der Mutation — würde Requirement 3.1 widersprechen.

**Unbekannte Feldpfade** (Requirement 6.7). Nach der Validierung durchläuft `collectUnknownPaths` den Payload und vergleicht jeden Feldpfad gegen die Menge der im normalisierten Modell abgebildeten Pfade. Array-Indizes werden zu `[]` normalisiert, sodass `grammar_categories[].content.icon_pdf` genau einen Protokolleintrag je Payload erzeugt und nicht einen je Kategorie. Die Verarbeitung läuft ohne Abbruch weiter.

> **Entwurfsentscheidung:** Requirement 6.7 fordert „höchstens einen Protokolleintrag je eindeutigem Feldpfad und Payload", definiert aber nicht, ob Indizes Teil des Pfads sind. Der Entwurf normalisiert sie weg; andernfalls würden die Symbolfelder der Kategorien und die `class`/`type`-Felder der 134 Themen mehrere hundert Warnungen je Katalog-Payload erzeugen. Nicht abgebildet und damit erwartbar protokolliert werden: `class`, `type`, `content.icon_pdf`, `content.icon_dark_pdf`, `content.icon_svg`, `content.icon_dark_svg`, `entity_map` sowie `premium` auf Kategorieebene.

**Idempotenz** (Requirement 4.14, 5.8). Jeder Schreibvorgang ist ein Upsert auf einem fachlichen Schlüssel: `(language, busuuId)` für Kategorien und Themen, `(userAccountId, grammarTopicId)` für den Lernstand. Es gibt keinen Schreibvorgang, der aus einem vorhandenen Stand einen weiteren Datensatz erzeugt, und keine Anreicherungslogik, die vom Vorzustand abhängt. Damit ist der zweite Lauf desselben Payloads ein Fixpunkt.

### Busuu_Serializer (nur Prüfmittel)

Der Serializer führt den normalisierten Bestand zurück in die Struktur eines Busuu-Payloads. Er ist das Gegenstück des Normalizers in der Round-Trip-Prüfung (Requirement 6.3, 6.4, 6.10).

```ts
// apps/backend/test/support/busuu-serializer.ts  (bewusst außerhalb von src/)
export function serializeCatalog(state: NormalizedCatalogState): CatalogPayload; // wirft SerializationFailure
export function serializeProgress(state: NormalizedProgressState): ProgressPayload;
```

Sicherstellung der Unerreichbarkeit über die GraphQL-API (Requirement 6.9), mehrfach abgesichert:

1. Die Datei liegt unter `apps/backend/test/support/` und damit außerhalb von `src/`. Das Build-`tsconfig` des Backends schließt `test/**` aus, sodass der Serializer im `dist`-Artefakt nicht existiert.
2. Es gibt keinen Nest-Provider, kein Modul und keinen Resolver, der ihn injiziert oder aufruft.
3. Eine ESLint-Regel `no-restricted-imports` verbietet Importe aus `test/support/**` in `src/**`.
4. Ein Test prüft, dass das erzeugte GraphQL-Schema kein Feld mit Serializer-Bezug enthält, und ein zweiter, dass kein `src`-Modul den Serializer importiert (Entwurfsentscheidung zur Absicherung).

Abbildungsregeln:

- Katalog: `id = grammar_review_<language>`, Kategorien aufsteigend nach `busuuId`, je Kategorie `structure` aus den Themen mit Sortierposition in Positionsreihenfolge, `grammar_topics` aus denselben Themen ohne die als `incomplete` markierten (damit entsteht wieder genau der Fall aus Requirement 4.12). Themen ohne Kategorie werden in das `grammar_topics`-Array der ersten Kategorie nach `busuuId` aufgenommen, aber in keine `structure` (damit entsteht wieder der Fall aus Requirement 4.17). Die Übersetzungskarte wird aus den gespeicherten Schlüsseln und den Klartexten `de`/`en` rekonstruiert; ein Inhaltsfeld mit `deResolved = false` erzeugt keinen Eintrag für diese Sprache, sodass die erneute Normalisierung wieder den Schlüssel als Klartext ablegt. `cefrLevel = UNBEKANNT` wird als `cefrLevelRaw` ausgegeben.
- Lernstand: `{ "status": "ok", "data": [...] }` mit `topic_id`, `strength`, `percentage`, sortiert nach `topic_id`, damit die Ausgabe deterministisch ist.
- Nur Entitäten mit `inCatalog = true` werden ausgegeben; Entitäten, die als nicht mehr im Katalog enthalten markiert sind, gehören nicht zum Payload, der den Zustand erzeugt hat.
- Lässt sich ein Datensatz nicht schemakonform abbilden, wirft der Serializer `SerializationFailure` mit fachlichem Schlüssel und Feldname und lässt den Bestand unverändert (Requirement 6.10).

### Catalog- und Progress-Abfragemodul

Dateien: `catalog.module.ts`, `catalog.resolver.ts`, `catalog.service.ts`, `loaders/topics-by-category.loader.ts`, `loaders/progress-by-topic.loader.ts`, `models/`.

```graphql
type Query {
  grammarCatalog(language: TargetLanguage!, filter: GrammarTopicFilter): [GrammarCategory!]!
}

input GrammarTopicFilter {
  cefrLevels: [CefrLevel!] # leer/fehlend = keine Einschränkung
  progress: ProgressFilter = ANY # WITH_PROGRESS | WITHOUT_PROGRESS | ANY
  includeRemovedFromCatalog: Boolean = false
}

type GrammarCategory {
  busuuId: ID!
  language: TargetLanguage!
  nameDe: String!
  nameEn: String!
  descriptionDe: String!
  descriptionEn: String!
  removedFromCatalog: Boolean!
  topics: [GrammarTopic!]!
}

type GrammarTopic {
  busuuId: ID!
  nameDe: String!
  nameEn: String!
  descriptionDe: String!
  descriptionEn: String!
  cefrLevel: CefrLevel!
  sortPosition: Int
  premium: Boolean!
  accessTier: String!
  incomplete: Boolean!
  removedFromCatalog: Boolean!
  untrained: Boolean! # Ungeübtes_Thema (R7.4)
  progress: GrammarProgress # null, wenn ungeübt
}

type GrammarProgress {
  strength: Int!
  percentage: Int!
  observedAt: DateTime!
}
```

- Sortierung: Kategorien aufsteigend nach `busuuId`; Themen innerhalb einer Kategorie aufsteigend nach `sortPosition`, bei Gleichheit nach `busuuId`. Themen ohne Sortierposition werden nach den positionierten einsortiert (Entwurfsentscheidung: Requirement 7.1 lässt den Fall offen; `NULLS LAST` ist die naheliegende Ordnung).
- `untrained` ist `true`, wenn kein Lernstand des angemeldeten Kontos vorliegt; das Thema bleibt trotzdem im Ergebnis (Requirement 7.4).
- Nicht unterstützte oder fehlende Zielsprache ⇒ `BAD_USER_INPUT` (Requirement 7.9); leeres Ergebnis ⇒ leere Liste ohne Fehler (Requirement 7.10).
- Als nicht mehr im Katalog enthalten markierte Themen erscheinen nur bei `includeRemovedFromCatalog: true` (Requirement 7.11).

**DataLoader** (Requirement 7.7). Je Auflösungsebene ein Loader, erzeugt pro Request (`scope: Scope.REQUEST` beziehungsweise Anlage im GraphQL-Kontext):

```ts
type TopicsKey = { categoryId: string; filterHash: string };
type ProgressKey = { userAccountId: string; grammarTopicId: string };

createTopicsByCategoryLoader(tx): DataLoader<TopicsKey, GrammarTopic[]>;
createProgressByTopicLoader(tx): DataLoader<ProgressKey, GrammarProgress | null>;
```

Der `filterHash` ist die stabile Serialisierung der Filterargumente. Innerhalb einer Query sind die Filter für alle Geschwister identisch, sodass der Loader alle Kategorie-Kennungen einer Ebene in genau einer `findMany`-Abfrage mit `where: { categoryId: { in: [...] } }` bündelt. Der Lernstand-Loader bündelt analog über `grammarTopicId: { in: [...] }` und setzt `userAccountId` fest auf das Konto des Access-Tokens — Mandantentrennung liegt damit im Loader und nicht im Resolver. Die Anzahl der Datenbankabfragen ist unabhängig von der Anzahl aufgelöster Kategorien: eine für die Kategorien, eine für die Themen, eine für die Lernstände.

`schema.gql` wird code-first aus den Decorators erzeugt (Requirement 7.8, 8 ff.) und nie handisch bearbeitet.

### Sentenza_Extension

```mermaid
sequenceDiagram
  participant Page as Busuu-Seite (MAIN)
  participant Hook as hook.ts (MAIN)
  participant Bridge as bridge.ts (ISOLATED)
  participant SW as Service Worker
  participant BE as GraphQL_API

  Page->>Hook: fetch("/progress")
  Hook->>Page: Response (unverändert, sofort)
  Hook->>Hook: response.clone().text() (asynchron)
  Hook-->>Bridge: window.postMessage({type:"SENTENZA/CAPTURE", nonce, ...})
  Bridge->>Bridge: nonce + origin prüfen, Muster zuordnen
  Bridge-->>SW: chrome.runtime.sendMessage({type:"SENTENZA/ENQUEUE", payloadKind, body, capturedAt})
  SW->>SW: in chrome.storage.local einreihen
  SW->>BE: submitBusuuPayload(...)
  BE-->>SW: rawPayloadId, processingState
  SW->>SW: Eintrag aus Warteschlange entfernen, Status fortschreiben
```

**Manifest** (Requirement 8.1, 8.5).

```jsonc
{
  "manifest_version": 3,
  "host_permissions": ["https://*.busuu.com/*", "http://localhost:4000/*"],
  "permissions": ["storage", "identity", "alarms"],
  "background": { "service_worker": "background/index.js", "type": "module" },
  "action": { "default_popup": "popup/index.html" },
  "content_scripts": [
    {
      "matches": ["https://*.busuu.com/*"],
      "js": ["inject/hook.js"],
      "run_at": "document_start",
      "world": "MAIN",
    },
    {
      "matches": ["https://*.busuu.com/*"],
      "js": ["content/bridge.js"],
      "run_at": "document_start",
      "world": "ISOLATED",
    },
  ],
}
```

Keine Berechtigung für alle Adressen. Die Backend-Adresse steht in `host_permissions`; sie ist über den Build konfigurierbar, eine andere Adresse verlangt eine Manifest-Änderung (Entwurfsentscheidung — dynamische Host-Berechtigungen würden `optional_host_permissions` und eine Zustimmungsabfrage verlangen, was für den lokalen Betrieb unnötig ist).

**Abfangen** (Requirement 8.5–8.7). `chrome.webRequest` kann in Manifest V3 keine Antwortinhalte lesen, `chrome.debugger` zeigt eine dauerhafte Debug-Leiste. Der Entwurf nutzt daher einen Content-Script-Eintrag mit `"world": "MAIN"` und `"run_at": "document_start"` — damit läuft `hook.ts` vor dem ersten Netzwerkaufruf der Seite im Seitenkontext, ohne dass ein `<script>`-Tag und `web_accessible_resources` nötig sind. `hook.ts` ersetzt `window.fetch` und `XMLHttpRequest.prototype.open/send` durch Umhüllungen, die

- bei `fetch` die Antwort unverändert an die Seite zurückgeben und den Inhalt aus `response.clone().text()` lesen,
- bei `XHR` im `loadend`-Listener `responseText` lesen, nachdem die Handler der Seite gelaufen sind,
- die Weitergabe in `queueMicrotask`/`setTimeout(…, 0)` auslagern, sodass der Seitenablauf nicht blockiert und die Zustellung nicht messbar, jedenfalls um weniger als 50 ms verzögert wird.

Ein Fehler in der Umhüllung darf den Seitenablauf nicht beeinflussen: jeder Ausleseversuch steht in `try/catch`, und der Rückgabewert der Umhüllung ist immer der unveränderte Wert der ursprünglichen Funktion.

**Mustererkennung** (Requirement 8.6, 8.13, 8.14).

```ts
// shared/endpoints.ts
export const ENDPOINT_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  payloadKind: PayloadKind;
}> = [
  { pattern: /\/progress(\?|$)/, payloadKind: PayloadKind.PROGRESS },
  {
    pattern: /grammar_review_[a-z]{2}(\?|$)/,
    payloadKind: PayloadKind.CATALOG,
  },
];
export function classifyUrl(url: string): PayloadKind | null;
```

Ergibt `classifyUrl` keinen Treffer, wird der Inhalt verworfen, nicht abgelegt und nicht übertragen. Es werden ausschließlich Antwortinhalte zutreffender Endpunkte erfasst — keine Seiteninhalte, Eingaben, Cookies oder Verlaufsdaten.

**Nachrichtenprotokoll.**

```ts
// MAIN → ISOLATED, über window.postMessage(msg, window.location.origin)
interface CaptureMessage {
  type: 'SENTENZA/CAPTURE';
  nonce: string; // je Seitenladung erzeugt, von hook.ts an bridge.ts über ein data-Attribut übergeben
  url: string;
  body: string;
  capturedAt: string; // ISO-8601
}

// ISOLATED → Service Worker, über chrome.runtime.sendMessage
interface EnqueueMessage {
  type: 'SENTENZA/ENQUEUE';
  payloadKind: PayloadKind;
  body: string;
  capturedAt: string;
}
interface EnqueueResponse {
  accepted: boolean;
  dropped: boolean;
}

// Popup → Service Worker
interface StatusRequest {
  type: 'SENTENZA/STATUS';
}
interface SignInRequest {
  type: 'SENTENZA/SIGN_IN';
}
```

`bridge.ts` verwirft Nachrichten mit fremdem `event.origin`, fehlendem oder falschem `nonce` und unbekanntem `type`. Der Nonce verhindert, dass Seitenskripte beliebige Inhalte in die Brücke schieben.

**Anmeldung** (Requirement 8.2, 8.3, 8.15). Der Service Worker startet `chrome.identity.launchWebAuthFlow` mit `response_type=id_token`, `nonce` und der Google-Client-Kennung, begrenzt durch ein Zeitlimit von 120 Sekunden. Das erhaltene Google-ID-Token geht unmittelbar an `signInWithGoogle` und wird nicht dauerhaft gespeichert. Access- und Refresh-Token landen in `chrome.storage.local`. Abbruch, Zeitüberschreitung oder Ablehnung durch das Backend führen dazu, dass kein Token gespeichert wird, der Status auf „nicht angemeldet" geht und das Popup den Grund anzeigt.

**Erneuerung** (Requirement 8.4, 8.16). Vor jeder Übertragung prüft der Service Worker die Restgültigkeit des Access-Tokens; unter 60 Sekunden ruft er `refreshAccessToken` und überträgt danach mit dem neuen Token. Schlägt die Erneuerung fehl oder fehlt ein Refresh-Token, werden beide Token entfernt, der Status geht auf „nicht angemeldet", das Popup verlangt eine neue Anmeldung, und weitere Inhalte werden nur noch zwischengespeichert.

**Warteschlange** (Requirement 8.9–8.11, 8.17). Die Warteschlange liegt vollständig in `chrome.storage.local`, nie nur im Speicher des Service Workers:

```ts
interface QueuedCapture {
  id: string;
  payloadKind: PayloadKind;
  body: string;
  capturedAt: string;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
}
interface ExtensionState {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: string | null;
  signedIn: boolean;
  queue: QueuedCapture[]; // höchstens 50
  lastSuccessfulUploadAt: string | null;
  lastError: string | null;
  droppedCount: number;
}
```

Ein Inhalt wird zuerst eingereiht und erst dann übertragen. Erfolg entfernt den Eintrag und setzt `lastSuccessfulUploadAt`. Fehlschlag belässt ihn in der Warteschlange und wiederholt bis zu dreimal nach 1, 4 und 16 Sekunden; danach bleibt er zwischengespeichert, und `lastError` erscheint im Popup. Ist die Obergrenze von 50 erreicht, wird der älteste Eintrag verdrängt, `droppedCount` erhöht und im Popup ein Hinweis angezeigt. Nach einer erfolgreichen Anmeldung wird die Warteschlange in Erfassungsreihenfolge geleert.

**Umgang mit der Beendigung des Service Workers.** Ein MV3-Service-Worker kann jederzeit beendet werden, üblicherweise nach etwa 30 Sekunden ohne Aktivität. Der Entwurf begegnet dem so:

- Der gesamte Zustand liegt in `chrome.storage.local`; nach einem Neustart ist keine Information verloren.
- Die drei Wiederholversuche (1 + 4 + 16 = 21 Sekunden) liegen innerhalb einer Aktivierung und werden über `setTimeout` gefahren, gehalten durch die laufende Übertragung.
- Zusätzlich sichert ein wiederkehrender `chrome.alarms`-Wecker ab: Bei jedem Start des Service Workers und bei jedem Weckerlauf wird die Warteschlange erneut abgearbeitet, sofern `nextAttemptAt` erreicht ist. Damit überlebt ein unterbrochener Versuch die Beendigung, statt verloren zu gehen. (`chrome.alarms` erlaubt keine Sekundengenauigkeit, taugt deshalb nur als Netz, nicht als Taktgeber der Wiederholungen.)
- Eine mehrfach übertragene Erfassung ist unschädlich: Requirement 3.7 verlangt ausdrücklich, dass gleiche Inhalte erneut angenommen werden, und die Normalisierung ist idempotent.

**Popup** (Requirement 8.12). Das Popup liest ausschließlich aus `chrome.storage.local` und zeigt Anmeldestatus, Zeitpunkt der letzten erfolgreichen Übertragung, Anzahl zwischengespeicherter Inhalte, letzte Fehlermeldung und gegebenenfalls den Hinweis auf verworfene Inhalte. Fehlt ein Zeitpunkt oder eine Fehlermeldung, erscheint ein Platzhalter („noch keine Übertragung", „kein Fehler"). Weil kein Netzaufruf nötig ist, bleibt die Anzeige weit unter einer Sekunde.

## Data Models

### Prisma-Schema

`apps/backend/prisma/schema.prisma` ist die einzige Quelle der Datenbankstruktur; jede Änderung läuft über eine eingecheckte Migration (Requirement 1.10). Der generierte Client wird ausschließlich über `src/prisma/prisma.types.ts` re-exportiert.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum PayloadKind {
  CATALOG
  PROGRESS
}

enum SubmissionSource {
  SENTENZA_EXTENSION
}

enum ProcessingState {
  VERARBEITET
  TEILWEISE_VERARBEITET
  FEHLGESCHLAGEN
}

enum CefrLevel {
  A1
  A2
  B1
  B2
  C1
  UNBEKANNT
}

enum TargetLanguage {
  ES
}

model UserAccount {
  id            String   @id @default(uuid())
  googleSubject String   @unique
  email         String
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  refreshTokens RefreshToken[]
  rawPayloads   RawPayload[]
  progress      GrammarProgress[]

  @@index([email])
}

model RefreshToken {
  id            String    @id @default(uuid())
  userAccountId String
  tokenHash     String    @unique // SHA-256 des opaken Tokens, hex
  issuedAt      DateTime  @default(now())
  expiresAt     DateTime
  revokedAt     DateTime?

  userAccount UserAccount @relation(fields: [userAccountId], references: [id], onDelete: Cascade)

  @@index([userAccountId, expiresAt])
}

model RawPayload {
  id                  String           @id @default(uuid())
  userAccountId       String
  payloadKind         PayloadKind
  submissionSource    SubmissionSource
  submittedAt         DateTime         @default(now())
  contentBytes        Int
  contentHash         String // SHA-256, hex; ausdrücklich NICHT eindeutig (R3.7)
  content             String           @db.Text // zeichengenau, unveränderlich (R3.2, R3.12)
  correlationId       String
  processingState     ProcessingState
  processedAt         DateTime?
  errorMessage        String?          @db.VarChar(2000)
  persistedEntryCount Int?
  discardedEntryCount Int?

  userAccount UserAccount       @relation(fields: [userAccountId], references: [id], onDelete: Cascade)
  progress    GrammarProgress[]

  @@index([userAccountId, submittedAt(sort: Desc)])
  @@index([userAccountId, payloadKind, submittedAt(sort: Desc)])
  @@index([userAccountId, processingState, submittedAt(sort: Desc)])
  @@index([contentHash])
}

model GrammarCategory {
  id                  String         @id @default(uuid())
  language            TargetLanguage
  busuuId             String // unverändert übernommen, 1–200 Zeichen
  nameKey             String? // Übersetzungsschlüssel, für die Round-Trip-Prüfung nötig
  nameDe              String         @default("")
  nameEn              String         @default("")
  nameDeResolved      Boolean        @default(true)
  nameEnResolved      Boolean        @default(true)
  descriptionKey      String?
  descriptionDe       String         @default("")
  descriptionEn       String         @default("")
  descDeResolved      Boolean        @default(true)
  descEnResolved      Boolean        @default(true)
  inCatalog           Boolean        @default(true)
  firstSeenAt         DateTime       @default(now())
  lastSeenInCatalogAt DateTime?
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  topics GrammarTopic[]

  @@unique([language, busuuId])
  @@index([language, inCatalog])
}

model GrammarTopic {
  id                  String         @id @default(uuid())
  language            TargetLanguage
  busuuId             String
  categoryId          String? // null bei R4.17 und R5.4
  sortPosition        Int? // aus structure, lückenlos ab 1 je Kategorie
  cefrLevel           CefrLevel      @default(UNBEKANNT)
  cefrLevelRaw        String? // unveränderter Originalwert bei UNBEKANNT (R4.9)
  nameKey             String?
  nameDe              String         @default("")
  nameEn              String         @default("")
  nameDeResolved      Boolean        @default(true)
  nameEnResolved      Boolean        @default(true)
  descriptionKey      String?
  descriptionDe       String         @default("") @db.Text // ungekürzt (R4.10)
  descriptionEn       String         @default("") @db.Text
  descDeResolved      Boolean        @default(true)
  descEnResolved      Boolean        @default(true)
  premium             Boolean        @default(false)
  accessTier          String         @default("")
  incomplete          Boolean        @default(false) // nur aus structure bekannt (R4.12)
  inCatalog           Boolean        @default(true) // R4.15, R5.4
  firstSeenAt         DateTime       @default(now())
  lastSeenInCatalogAt DateTime?
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  category GrammarCategory?  @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  progress GrammarProgress[]

  @@unique([language, busuuId])
  @@index([categoryId, sortPosition, busuuId])
  @@index([language, cefrLevel])
  @@index([language, inCatalog])
}

model GrammarProgress {
  id             String   @id @default(uuid())
  userAccountId  String
  grammarTopicId String
  strength       Int
  percentage     Int
  observedAt     DateTime // Zeitpunkt der Einreichung des Payloads (R5.3)
  rawPayloadId   String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  userAccount  UserAccount  @relation(fields: [userAccountId], references: [id], onDelete: Cascade)
  grammarTopic GrammarTopic @relation(fields: [grammarTopicId], references: [id], onDelete: Cascade)
  rawPayload   RawPayload?  @relation(fields: [rawPayloadId], references: [id], onDelete: SetNull)

  @@unique([userAccountId, grammarTopicId])
  @@index([userAccountId])
  @@index([grammarTopicId])
}
```

### Modellierung der zweisprachigen Texte

Entscheidung: **Spaltenpaare je Inhaltsfeld** (`nameDe`/`nameEn`, `descriptionDe`/`descriptionEn`) statt einer separaten Tabelle `LocalizedText`.

Begründung:

- Die Sprachmenge ist durch die Requirements geschlossen und klein: genau `de` und `en` (Requirement 4.5, 7.2). Eine Übersetzungstabelle löst ein Problem, das hier nicht existiert.
- Requirement 7.7 verlangt höchstens eine Datenbankabfrage je Auflösungsebene. Spaltenpaare liefern Bezeichnung und Beschreibung im gleichen Datensatz wie das Thema; eine Texttabelle bräuchte einen weiteren Loader und eine weitere Abfrage.
- Die Upserts der Normalisierung bleiben atomar und ohne Kindsatz-Abgleich, was die Idempotenz nach Requirement 4.14 deutlich einfacher belegbar macht.
- Requirement 4.6 verlangt eine Kennzeichnung je Inhaltsfeld **und** Sprache. Als Spalten sind das vier Wahrheitswerte je Entität — überschaubar; als Tabelle wären es vier Datensätze mit eigener Lebensdauer.

Preis der Entscheidung: Eine dritte Sprache kostet eine Migration mit neuen Spalten. Das ist bewusst in Kauf genommen; es steht keine dritte Sprache in Aussicht.

Zusätzlich gespeichert wird je Inhaltsfeld der **Übersetzungsschlüssel** (`nameKey`, `descriptionKey`). Er ist kein Selbstzweck: ohne ihn kann der Serializer keine `translation_map` rekonstruieren, und die Round-Trip-Eigenschaften aus Requirement 6.5 wären nicht prüfbar.

### GraphQL-Typen

Das Schema entsteht code-first aus Decorators; `apps/backend/schema.gql` ist ein **generiertes** Artefakt und wird nie handisch bearbeitet (Requirement 7.8). Es ist eingecheckt, damit GraphQL Code Generator in `@sentenza/api-client` daraus typisierte Operationen erzeugen kann.

```graphql
enum PayloadKind {
  CATALOG
  PROGRESS
}
enum ProcessingState {
  VERARBEITET
  TEILWEISE_VERARBEITET
  FEHLGESCHLAGEN
}
enum SubmissionSource {
  SENTENZA_EXTENSION
}
enum CefrLevel {
  A1
  A2
  B1
  B2
  C1
  UNBEKANNT
}
enum TargetLanguage {
  ES
}
enum ProgressFilter {
  WITH_PROGRESS
  WITHOUT_PROGRESS
  ANY
}

input SignInWithGoogleInput {
  idToken: String!
}
input RefreshAccessTokenInput {
  refreshToken: String!
}
input SubmitBusuuPayloadInput {
  payloadKind: PayloadKind!
  content: String!
}

type AccessTokenPayload {
  accessToken: String!
  accessTokenExpiresAt: DateTime!
}

type IngestionResult {
  rawPayloadId: ID!
  processingState: ProcessingState!
  persistedEntryCount: Int
  discardedEntryCount: Int
  warningCount: Int!
}

type RawPayloadSummary {
  id: ID!
  submittedAt: DateTime!
  payloadKind: PayloadKind!
  submissionSource: SubmissionSource!
  contentBytes: Int!
  contentHash: String!
  processingState: ProcessingState!
  processedAt: DateTime
  errorMessage: String
}

type RawPayloadPage {
  entries: [RawPayloadSummary!]!
  totalCount: Int!
  limit: Int!
  offset: Int!
}
type RawPayloadContent {
  id: ID!
  contentHash: String!
  content: String!
}
```

Die Enumerationen werden **nicht** im Backend deklariert, sondern aus `@sentenza/domain` importiert und per `registerEnumType` bei GraphQL angemeldet. Damit gibt es je Enumeration genau einen Deklarationsort für Prisma-Modell, GraphQL-Schema, Backend-Logik und Extension (Requirement 1.4).

### Konfigurationsmodell

`.env.example` führt jede gelesene Variable mit Platzhalter, ohne echten Zugangsdatenwert (Requirement 1.8).

| Variable                      | Zweck                                                            | Platzhalter / Vorgabe                                         |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                | Verbindung zur PostgreSQL-Instanz                                | `postgresql://sentenza:sentenza@localhost:5432/sentenza`      |
| `TEST_DATABASE_URL`           | Verbindung zur Testdatenbank                                     | `postgresql://sentenza:sentenza@localhost:5433/sentenza_test` |
| `PORT`                        | Port der GraphQL_API (Requirement 1.9)                           | `4000`                                                        |
| `GOOGLE_CLIENT_ID`            | erwarteter `aud` des Google_ID_Token                             | `<google-client-id>`                                          |
| `GOOGLE_ISSUER`               | erwarteter `iss`                                                 | `https://accounts.google.com`                                 |
| `GOOGLE_JWKS_URI`             | Quelle der Google-JWKS                                           | `https://www.googleapis.com/oauth2/v3/certs`                  |
| `GOOGLE_JWKS_TIMEOUT_MS`      | Abbruch des JWKS-Abrufs (Requirement 2.1, 2.13)                  | `5000`                                                        |
| `AUTH_ALLOWED_EMAILS`         | Konto_Freigabeliste, kommagetrennt                               | `du@example.com`                                              |
| `JWT_SECRET`                  | Signaturgeheimnis der Sentenza-Access-Tokens                     | `<zufallswert>`                                               |
| `ACCESS_TOKEN_TTL_MINUTES`    | Gültigkeit des Access-Tokens, zulässig 5–60 (Requirement 2.6)    | `15`                                                          |
| `REFRESH_TOKEN_TTL_DAYS`      | Gültigkeit des Refresh-Tokens (Requirement 2.5)                  | `30`                                                          |
| `INGESTION_MAX_PAYLOAD_BYTES` | Größenbegrenzung der Einreichung (Requirement 3.8)               | `10485760`                                                    |
| `DEFAULT_TARGET_LANGUAGE`     | Zielsprache für Themen aus Lernstands-Payloads (Requirement 5.4) | `es`                                                          |
| `DB_STARTUP_TIMEOUT_MS`       | Frist für die Datenbankverbindung beim Start (Requirement 1.12)  | `60000`                                                       |
| `LOG_LEVEL`                   | Protokollschwelle                                                | `info`                                                        |
| `SENTENZA_BACKEND_URL`        | Extension: Adresse der GraphQL_API                               | `http://localhost:4000/graphql`                               |
| `SENTENZA_GOOGLE_CLIENT_ID`   | Extension: Client-Kennung für `launchWebAuthFlow`                | `<google-client-id>`                                          |

## Error Handling

### Geteilte Fehlercodes

```ts
// packages/domain/src/error-code.ts
export enum SentenzaErrorCode {
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  FORBIDDEN = 'FORBIDDEN',
  BAD_USER_INPUT = 'BAD_USER_INPUT',
  UPSTREAM_UNAVAILABLE = 'UPSTREAM_UNAVAILABLE',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class SentenzaError extends Error {
  constructor(
    readonly code: SentenzaErrorCode,
    message: string,
    readonly details?: Record<string, unknown>, // z. B. { path: 'input.content' }
  ) {
    super(message);
  }
}
```

Die Enumeration liegt in `@sentenza/domain` und wird von Backend und Extension genutzt (Requirement 9.1). Zuordnung: Google-Token ungültig, Access-Token fehlt/ungültig, Refresh-Token ungültig ⇒ `UNAUTHENTICATED`; E-Mail nicht in der Freigabeliste ⇒ `FORBIDDEN`; Eingabeverstöße, unbekannte Payload-Art, leerer Inhalt, Überschreitung der Größengrenze, nicht unterstützte Zielsprache ⇒ `BAD_USER_INPUT`; JWKS nicht erreichbar ⇒ `UPSTREAM_UNAVAILABLE`; alles Übrige ⇒ `INTERNAL_SERVER_ERROR`.

### Apollo-Fehlerformatierer

```ts
formatError(formattedError, originalError) {
  const correlationId = getCorrelationId(originalError) ?? randomUUID();
  if (originalError instanceof SentenzaError) {
    return { message: originalError.message, extensions: { code: originalError.code, correlationId, ...originalError.details } };
  }
  logger.error({ correlationId, component, causeChain: flattenCauses(originalError) });
  return {
    message: `Interner Fehler. Korrelationskennung: ${correlationId}`,
    extensions: { code: SentenzaErrorCode.INTERNAL_SERVER_ERROR, correlationId },
  };
}
```

Jeder Fehler, der keinem Enumerationswert zugeordnet ist, wird zu `INTERNAL_SERVER_ERROR` (Requirement 9.1). Die Antwort enthält die Korrelationskennung und ausdrücklich keinen Aufrufstapel, keine Datenbankmeldung, keinen Dateipfad und keinen Hostnamen (Requirement 9.3); `stacktrace` wird durch Deaktivieren von `includeStacktraceInErrorResponses` auch in der Entwicklungsumgebung unterdrückt. Eingabeverstöße nennen jedes verletzte Feld mit seinem Pfad innerhalb der Eingabe (Requirement 9.2); Quelle ist bei GraphQL-Inputs `class-validator`, bei Payloads der Zod-Pfad.

### Protokollierung und Redaction

Strukturierte JSON-Protokolleinträge mit `timestamp`, `component`, `correlationId`, `level`, `message` und, sofern vorhanden, `rawPayloadId` und `step` (Requirement 9.3, 9.4). Eine zentrale Redaction-Liste entfernt vor der Ausgabe die Feldnamen `idToken`, `accessToken`, `refreshToken`, `authorization`, `jwtSecret`, `content` und `body`. Anstelle eines Payload-Inhalts werden ausschließlich `contentHash` und `contentBytes` protokolliert (Requirement 9.5). Die Redaction ist ein Serializer-Hook des Loggers, nicht die Disziplin der Aufrufstellen — eine neue Protokollstelle kann Token damit nicht versehentlich ausgeben.

### Transaktionsgrenzen

```mermaid
sequenceDiagram
  participant R as Resolver
  participant I as Ingestion_Service
  participant DB as PostgreSQL

  R->>I: submitBusuuPayload
  I->>DB: T1: INSERT RawPayload (content, Metadaten)  [commit]
  Note over I,DB: erst nach bestätigtem Commit beginnt die Normalisierung (R3.2)
  I->>DB: T2: Normalisierung, alle Upserts  [commit oder rollback]
  alt T2 erfolgreich
    I->>DB: T3: UPDATE RawPayload SET state=VERARBEITET|TEILWEISE_VERARBEITET
  else T2 fehlgeschlagen
    I->>DB: T3: UPDATE RawPayload SET state=FEHLGESCHLAGEN, errorMessage
  end
  I-->>R: IngestionResult
```

Drei getrennte Transaktionen, und zwar aus einem konkreten Grund: Requirement 3.5 verlangt, dass der Zustand `FEHLGESCHLAGEN` am Eintrag stehen bleibt, während Requirement 3.6 und 9.6 verlangen, dass sämtliche Änderungen der Normalisierung zurückgerollt werden. Beides zusammen geht nur, wenn der Rohdateneintrag nicht Teil der Normalisierungstransaktion ist. T1 schreibt den Eintrag und ist vor Beginn von T2 festgeschrieben. T2 umfasst ausschließlich Schreibvorgänge am normalisierten Bestand und wird bei jedem Fehler vollständig zurückgerollt. T3 läuft danach in eigener Transaktion und schreibt nur Zustandsfelder des bereits bestehenden Eintrags. Der Eintrag und sein Inhalt überleben jeden Fehlschlag (Requirement 3.12, 9.6).

Scheitert T3 selbst — etwa weil die Datenbank inzwischen weg ist —, bleibt der Eintrag im zuvor gesetzten Zustand stehen; das ist an der Kombination aus fehlendem `processedAt` und fehlender Fehlermeldung erkennbar. (Entwurfsentscheidung: kein Wiederaufsetzmechanismus in diesem Spec; ein erneuter Aufruf der Normalisierung ist ohnehin aus dem aufbewahrten Rohinhalt möglich.)

### Health-Endpunkt

`@nestjs/terminus` stellt `GET /health` bereit (Requirement 9.7–9.9). Der Indikator führt `SELECT 1` über Prisma mit einem Zeitlimit von 5 Sekunden aus. Die Antwort nennt den Gesamtzustand und das Ergebnis je geprüfter Abhängigkeit:

```json
{
  "status": "ok",
  "details": { "database": { "status": "up", "durationMs": 7 } }
}
```

Bei nicht erreichbarer Datenbank ist `status` `error`, `database.status` `down` und die Abhängigkeit ausdrücklich benannt.

### Startprüfungen

Fehlende oder unzulässige Umgebungsvariable ⇒ Abbruch mit Nennung des Variablennamens. Datenbank nicht innerhalb von `DB_STARTUP_TIMEOUT_MS` (Vorgabe 60.000 ms) erreichbar ⇒ Abbruch mit Nennung der fehlgeschlagenen Verbindung. In beiden Fällen wird kein Port geöffnet und `process.exit(1)` gesetzt (Requirement 1.12).

### Fehlerbehandlung in der Extension

Die Extension unterscheidet nach Fehlercode aus `extensions.code`: `UNAUTHENTICATED` und `FORBIDDEN` führen zum Verwerfen der Token und zur Aufforderung, sich neu anzumelden; `BAD_USER_INPUT` wird nicht wiederholt, weil eine Wiederholung dieselbe Ablehnung erzeugen würde, und der Eintrag wird mit der Meldung im Popup zwischengespeichert belassen; Netzfehler, `UPSTREAM_UNAVAILABLE` und `INTERNAL_SERVER_ERROR` werden nach 1, 4 und 16 Sekunden wiederholt (Requirement 8.10).

## Correctness Properties

_Eine Eigenschaft ist ein Merkmal oder Verhalten, das über alle gültigen Ausführungen eines Systems hinweg gelten soll — im Kern eine formale Aussage darüber, was das System tun muss. Eigenschaften sind die Brücke zwischen einer für Menschen lesbaren Spezifikation und maschinell prüfbaren Korrektheitsgarantien._

Die Akzeptanzkriterien wurden vorab einzeln auf Prüfbarkeit untersucht und klassifiziert. Kriterien, die Werkzeug-, Struktur- oder Infrastrukturvorgaben beschreiben (Requirement 1 mit Ausnahme von 1.12, große Teile von Requirement 10, Manifest- und Health-Vorgaben), sind keine Eigenschaften über Programmverhalten und werden über Beispiel-, Integrations- und Meta-Tests abgedeckt. Aus den verbleibenden Kriterien sind die folgenden Eigenschaften nach Zusammenführung redundanter Aussagen entstanden; jede ist für sich prüfbar und keine wird von einer anderen impliziert.

Kennzeichnung: **[rein]** = ohne Datenbank prüfbar, **[db]** = gegen die Testdatenbank.

**Verlustfreiheit und Idempotenz der Normalisierung**

### Property 1: Round-Trip-Verlustfreiheit für Katalog-Payloads **[db]**

_Für jeden_ schemakonformen Katalog-Payload — einschließlich solcher mit UUID-basierten Busuu-Kennungen, fehlenden Übersetzungsschlüsseln, leeren `value`-Feldern mit nicht-leeren `alternative_values`, unbekannten oder fehlenden `content.level`-Werten, `structure`-Kennungen ohne zugehöriges Objekt, Themen ohne `structure`-Referenz und leeren Sammlungen — ergibt die Abfolge aus Normalisierung, Serialisierung und erneuter Normalisierung bei gleichem Einreichungszeitpunkt einen normalisierten Datenbestand, der im Sinne von Requirement 6.8 identisch zu dem der einmaligen Normalisierung ist; die Serialisierung erfüllt dabei das deklarierte Katalog-Schema.

**Validates: Requirements 6.3, 6.5**

### Property 2: Round-Trip-Verlustfreiheit für Lernstands-Payloads **[db]**

_Für jeden_ schemakonformen Lernstands-Payload — einschließlich solcher mit Prozentwerten an den Bereichsgrenzen 0 und 100, der Stärke 0, Themen-Kennungen ohne persistiertes Grammatik_Thema und leerer `data`-Liste — ergibt die Abfolge aus Normalisierung, Serialisierung und erneuter Normalisierung bei gleichem Einreichungszeitpunkt einen normalisierten Datenbestand, der im Sinne von Requirement 6.8 identisch zu dem der einmaligen Normalisierung ist; die Serialisierung erfüllt dabei das deklarierte Lernstands-Schema.

**Validates: Requirements 6.4, 6.6**

### Property 3: Idempotenz der Katalog-Normalisierung **[db]**

_Für jeden_ schemakonformen Katalog-Payload gilt: die zweimalige Verarbeitung hintereinander hinterlässt denselben normalisierten Datenbestand wie die einmalige Verarbeitung — gleiche Anzahl Kategorien und Themen, gleiche fachliche Schlüssel, gleiche Bezeichnungen, Beschreibungen, CEFR_Level, Sortierpositionen und Kategoriezuordnungen, keine zusätzliche Entität.

**Validates: Requirements 4.14**

### Property 4: Idempotenz der Lernstands-Normalisierung **[db]**

_Für jeden_ schemakonformen Lernstands-Payload gilt: die zweimalige Verarbeitung hintereinander mit demselben Einreichungszeitpunkt hinterlässt dieselbe Anzahl an Lernstand-Datensätzen sowie je Grammatik_Thema dieselbe Stärke, denselben Prozentwert und denselben Zeitpunkt der letzten Beobachtung wie die einmalige Verarbeitung.

**Validates: Requirements 5.8**

### Property 5: Validierung vor jedem Schreibvorgang, Pfad der ersten Verletzung **[db]**

_Für jeden_ Payload, der das für seine Payload-Art deklarierte Schema an genau einer bekannten Stelle verletzt, gilt: die Verarbeitung bricht ab, der normalisierte Datenbestand ist vor und nach dem Versuch identisch, und die gemeldete Fehlermeldung nennt die Payload-Art sowie genau den verletzten Feldpfad.

**Validates: Requirements 6.1, 6.2**

### Property 6: Unbekannte Feldpfade werden vollständig und dublettenfrei protokolliert **[rein]**

_Für jeden_ schemakonformen Payload, dem an beliebigen Stellen zusätzliche, im normalisierten Modell nicht abgebildete Felder beigefügt werden, gilt: die Menge der erzeugten Warnungen entspricht genau der Menge der eindeutigen unbekannten Feldpfade dieses Payloads, enthält je Pfad höchstens einen Eintrag, und die Verarbeitung der übrigen Felder läuft ohne Abbruch zu Ende.

**Validates: Requirements 6.7**

**Aufnahme und Aufbewahrung roher Payloads**

### Property 7: Einreichung und Abruf sind ein zeichengenauer Round-Trip **[db]**

_Für jede_ nicht-leere Zeichenkette innerhalb der Größengrenze gilt: nach der Einreichung liefert die Abruf-Query denselben Payload-Inhalt zeichengleich zurück, der am Eintrag gespeicherte Inhalts-Hash entspricht dem SHA-256 dieses Inhalts, die gespeicherte Größe entspricht seiner Byte-Länge in UTF-8, und die Metadaten Zeitpunkt, Benutzerkonto, Payload-Art und Quelle der Einreichung entsprechen dem Vorgang.

**Validates: Requirements 3.2, 3.3, 3.13**

### Property 8: Die Aufbewahrung ist monoton **[db]**

_Für jede_ Folge von Einreichungen, Normalisierungen und Zustandsänderungen gilt: jeder zuvor angelegte Eintrag des Raw_Payload_Store existiert weiterhin mit unverändertem Inhalt, unverändertem Inhalts-Hash, unveränderter Größe und unverändertem Zeitpunkt der Einreichung, und die mehrfache Einreichung desselben Inhalts erzeugt je Einreichung einen eigenen Eintrag mit eigener Kennung.

**Validates: Requirements 3.7, 3.12**

### Property 9: Ein Fehlschlag ändert den normalisierten Bestand nicht und wird am erhaltenen Eintrag vermerkt **[db]**

_Für jeden_ Payload, dessen Normalisierung fehlschlägt, und _für jeden_ vorher aufgebauten normalisierten Datenbestand gilt: der normalisierte Datenbestand ist nach dem Vorgang mit dem Zustand vor dem Vorgang identisch, der Eintrag im Raw_Payload_Store existiert weiterhin mit unverändertem Inhalt, sein Verarbeitungszustand ist `FEHLGESCHLAGEN`, und die hinterlegte Fehlermeldung ist nicht leer und höchstens 2.000 Zeichen lang.

**Validates: Requirements 3.5, 3.6, 9.6**

### Property 10: Die Größengrenze entscheidet über Annahme und Ablehnung **[db]**

_Für jede_ Zeichenkette gilt: die Einreichung wird genau dann angenommen, wenn ihre Byte-Länge in UTF-8 die konfigurierte Größenbegrenzung nicht überschreitet und sie nicht leer ist; andernfalls wird sie mit `BAD_USER_INPUT` abgelehnt, es entsteht kein Eintrag im Raw_Payload_Store, und der normalisierte Datenbestand bleibt unverändert.

**Validates: Requirements 3.8, 3.11**

### Property 11: Der zurückgegebene Verarbeitungszustand entspricht dem persistierten **[db]**

_Für jeden_ eingereichten Payload gilt: der an den Client zurückgegebene Verarbeitungszustand ist ein Wert aus `VERARBEITET`, `TEILWEISE_VERARBEITET`, `FEHLGESCHLAGEN`, die zurückgegebene Kennung bezeichnet einen bestehenden Eintrag des einreichenden Benutzerkontos, und der zurückgegebene Zustand stimmt mit dem an diesem Eintrag gespeicherten überein.

**Validates: Requirements 3.4, 3.9**

### Property 12: Die Auflistung der Rohdaten erfüllt Ordnung, Filter und Seitengrenze **[db]**

_Für jeden_ Bestand von Einträgen zweier Benutzerkonten und _für jede_ Kombination aus Filter nach Payload-Art, Filter nach Verarbeitungszustand und Seitenparametern gilt: das Ergebnis enthält ausschließlich Einträge des angemeldeten Benutzerkontos, ist absteigend nach Zeitpunkt der Einreichung sortiert, enthält ausschließlich Einträge, die allen gesetzten Filtern entsprechen, und umfasst höchstens 100 Einträge.

**Validates: Requirements 3.10**

**Normalisierung des Katalogs**

### Property 13: Die Zielsprache folgt aus der Katalog-Kennung **[db]**

_Für jede_ Katalog-Kennung gilt: enthält das Segment hinter dem letzten Unterstrich, ohne Beachtung der Groß- und Kleinschreibung, einen unterstützten Sprach-Code, so tragen alle im Vorgang angelegten oder aktualisierten Entitäten genau diese Zielsprache; andernfalls bricht die Verarbeitung mit einer Meldung ab, die die Kennung nennt, und es wird keine Grammatik_Kategorie und kein Grammatik_Thema angelegt oder geändert.

**Validates: Requirements 4.1, 4.16**

### Property 14: Die persistierte Entitätsmenge ist vollständig und schlüsseltreu **[db]**

_Für jeden_ schemakonformen Katalog-Payload gilt nach der Normalisierung: die Menge der persistierten Kategorie-Schlüssel entspricht genau der Menge der Kennungen unter `grammar_categories`; die Menge der persistierten Themen-Schlüssel entspricht genau der Vereinigung aller Kennungen unter `grammar_topics` und aller Kennungen in allen Feldern `structure`; jeder fachliche Schlüssel ist zeichengleich zur Busuu-Kennung im Payload; jedes Thema, dessen Kennung in einem `structure` steht, ist der zugehörigen Kategorie zugeordnet; jedes Thema ohne Objekt unter `grammar_topics` ist als unvollständig gekennzeichnet und trägt `UNBEKANNT`; jedes Thema ohne `structure`-Referenz ist ohne Kategorie und ohne Sortierposition persistiert; `premium` und `access_tier` entsprechen dem Payload beziehungsweise `false` und dem leeren Wert.

**Validates: Requirements 4.2, 4.3, 4.4, 4.12, 4.13, 4.17**

### Property 15: Inhaltsfelder werden je Sprache regelkonform und ungekürzt aufgelöst **[rein]**

_Für jeden_ Übersetzungsschlüssel und _für jede_ Übersetzungskarte gilt je Sprache aus `de` und `en`: liegt unter `value` ein nicht-leerer Wert, wird genau dieser persistiert; sonst der erste nicht-leere Wert aus `alternative_values` in Reihenfolge seines Auftretens; sonst der Übersetzungsschlüssel selbst, wobei das Inhaltsfeld für diese Sprache als unaufgelöst gekennzeichnet und eine Warnung erzeugt wird. Der persistierte Text ist in allen Fällen zeichengleich zum gewählten Wert und wird nicht gekürzt.

**Validates: Requirements 4.5, 4.6, 4.7, 4.10**

### Property 16: Die CEFR-Abbildung ist total **[rein]**

_Für jeden_ Wert des Felds `content.level`, einschließlich Fehlen und leerer Zeichenkette, gilt: entspricht er ohne Beachtung der Groß- und Kleinschreibung einem der Werte `a1`, `a2`, `b1`, `b2`, `c1`, so wird genau dieser CEFR_Level persistiert; andernfalls wird `UNBEKANNT` zusammen mit dem unveränderten Originalwert persistiert und eine Warnung erzeugt, während alle übrigen Felder des Grammatik_Thema unverändert weiterverarbeitet werden.

**Validates: Requirements 4.8, 4.9**

### Property 17: Sortierpositionen bilden je Kategorie eine lückenlose Folge ab 1 **[db]**

_Für jede_ Liste `structure` einer Grammatik_Kategorie, auch mit mehrfach genannten Themen-Kennungen, gilt: die Sortierpositionen der zugeordneten Grammatik_Themen sind genau die Zahlen 1 bis n ohne Lücke und ohne Wiederholung, wobei n die Anzahl der verschiedenen Kennungen in `structure` ist, und die Reihenfolge der Positionen entspricht der Reihenfolge des ersten Auftretens dieser Kennungen.

**Validates: Requirements 4.11**

### Property 18: Verschwundene Entitäten werden erhalten und gekennzeichnet **[db]**

_Für jedes_ Paar aus einem Katalog-Payload und einer Verkleinerung desselben Payloads gilt nach der Verarbeitung beider in dieser Reihenfolge: jede Kategorie und jedes Thema des ersten Payloads existiert weiterhin; die im zweiten Payload entfallenen Entitäten sind als nicht mehr im Katalog enthalten gekennzeichnet und behalten Bezeichnung, Beschreibung, CEFR_Level, Sortierposition, Kategoriezuordnung und zugehörigen Lernstand unverändert; keine Entität wird gelöscht.

**Validates: Requirements 4.15, 4.18**

**Normalisierung des Lernstands**

### Property 19: Je Konto und Thema bleibt genau der letzte gültige Eintrag **[db]**

_Für jeden_ Lernstands-Payload, auch mit mehrfach genannten Themen-Kennungen, gilt: je Kombination aus Benutzerkonto und Grammatik_Thema existiert genau ein Lernstand-Datensatz, dessen Stärke und Prozentwert unverändert dem in der Reihenfolge unter `data` letzten gültigen Eintrag dieser Kennung entsprechen und dessen Zeitpunkt der letzten Beobachtung dem Zeitpunkt der Einreichung des zugrunde liegenden Payloads entspricht und nicht dem Zeitpunkt der Normalisierung.

**Validates: Requirements 5.1, 5.2, 5.3, 5.11**

### Property 20: Ungültige Einträge werden verworfen, gültige verarbeitet, Zählwerte stimmen **[db]**

_Für jeden_ Lernstands-Payload aus beliebig gemischten gültigen und ungültigen Einträgen — fehlende oder leere `topic_id`, fehlendes `percentage`, nicht ganzzahliger Prozentwert, Prozentwert außerhalb 0 bis 100, fehlendes `strength`, Stärke ohne nicht-negative Ganzzahligkeit — gilt: jeder gültige Eintrag ist persistiert, kein ungültiger Eintrag hat einen Lernstand oder ein Grammatik_Thema erzeugt, ein bereits persistierter Lernstand eines von einem ungültigen Eintrag betroffenen Grammatik_Thema ist unverändert, der Verarbeitungszustand ist genau dann `TEILWEISE_VERARBEITET`, wenn mindestens ein Eintrag verworfen wurde, und die hinterlegten Anzahlen verworfener und persistierter Einträge entsprechen der tatsächlichen Aufteilung.

**Validates: Requirements 5.5, 5.6, 5.7, 5.10**

### Property 21: Unbekannte Themen-Kennungen erzeugen ein gebundenes Thema **[db]**

_Für jeden_ Lernstands-Eintrag mit einer Themen-Kennung, zu der kein Grammatik_Thema persistiert ist, gilt: es entsteht genau ein Grammatik_Thema mit dieser Kennung und ohne Bezeichnung, es ist als nicht im Grammatik_Katalog enthalten gekennzeichnet, der Lernstand ist daran gebunden, und eine Warnung wird protokolliert.

**Validates: Requirements 5.4**

### Property 22: Fehlende Einträge lassen bestehende Lernstände unberührt **[db]**

_Für jeden_ persistierten Lernstand und _für jeden_ Lernstands-Payload, der die zugehörige Themen-Kennung nicht enthält — einschließlich des Payloads mit leerer `data`-Liste — gilt: Stärke, Prozentwert und Zeitpunkt der letzten Beobachtung des persistierten Lernstands sind nach der Verarbeitung unverändert, und der Lernstand ist nicht gelöscht.

**Validates: Requirements 5.9**

### Property 23: Ein abweichender Status bricht ohne Wirkung ab **[db]**

_Für jeden_ Lernstands-Payload, dessen Feld `status` einen anderen Wert als `ok` enthält, gilt: die Verarbeitung bricht mit einer Fehlermeldung ab, die den abweichenden Wert nennt, und kein Lernstand wird angelegt oder geändert.

**Validates: Requirements 5.12**

**Anmeldung, Autorisierung, Mandantentrennung**

### Property 24: Ein Google-ID-Token wird genau bei vollständiger Gültigkeit angenommen **[rein]**

_Für jedes_ Google_ID_Token gilt: die Prüfung ist genau dann erfolgreich, wenn das Token syntaktisch lesbar ist, seine Signatur gegen den anhand der Schlüsselkennung ausgewählten JWKS-Schlüssel verifizierbar ist, `iss` der konfigurierten Issuer-Kennung entspricht, `aud` der konfigurierten Client-Kennung entspricht, `exp` mit einer Toleranz von höchstens 60 Sekunden in der Zukunft liegt und `email_verified` den Wert `true` hat; andernfalls wird die Anmeldung mit `UNAUTHENTICATED` abgelehnt, es wird kein Sentenza_Access_Token und kein Sentenza_Refresh_Token ausgestellt, und kein Benutzerkonto wird angelegt oder geändert.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 25: Die Freigabeliste entscheidet über den Zugang **[rein]**

_Für jede_ Konto*Freigabeliste und \_für jede* E-Mail-Adresse eines geprüften Google_ID_Token gilt: die Anmeldung und die Erneuerung sind genau dann zulässig, wenn die Adresse nach Entfernen umgebender Leerzeichen und Umwandlung in Kleinbuchstaben in der gleichermaßen normalisierten Liste enthalten ist; andernfalls wird mit `FORBIDDEN` abgelehnt, kein Benutzerkonto angelegt und kein Token ausgestellt.

**Validates: Requirements 2.4**

### Property 26: Ausgestellte Tokens tragen die konfigurierten Gültigkeitsdauern **[db]**

_Für jede_ erfolgreiche Anmeldung und _für jede_ erfolgreiche Erneuerung gilt: die Antwort enthält ein prüfbares Sentenza_Access_Token, dessen Gültigkeitsdauer dem konfigurierten Wert zwischen 5 und 60 Minuten entspricht, sowie den zugehörigen Ablaufzeitpunkt; bei einer Anmeldung zusätzlich ein Sentenza_Refresh_Token mit einer Gültigkeitsdauer von 30 Tagen und dessen Ablaufzeitpunkt.

**Validates: Requirements 2.5, 2.6, 2.9**

### Property 27: Je Google-Subject-Kennung existiert genau ein Benutzerkonto **[db]**

_Für jede_ Folge erfolgreicher Anmeldungen mit derselben Google-Subject-Kennung und beliebigen E-Mail-Adressen aus der Freigabeliste gilt: es existiert genau ein Benutzerkonto mit dieser Subject-Kennung, und seine gespeicherte E-Mail-Adresse ist die der letzten Anmeldung.

**Validates: Requirements 2.7, 2.8**

### Property 28: Ein nicht vorlagefähiges Refresh-Token führt zu keiner Erneuerung **[db]**

_Für jedes_ Sentenza_Refresh_Token, das nicht von Auth_Service ausgestellt wurde, abgelaufen ist, widerrufen wurde oder keinem bestehenden Benutzerkonto zugeordnet werden kann, gilt: die Erneuerung wird mit `UNAUTHENTICATED` abgelehnt, und es wird kein neues Sentenza_Access_Token ausgestellt.

**Validates: Requirements 2.14**

### Property 29: Jede Operation außer Anmeldung und Erneuerung ist geschützt **[db]**

_Für jedes_ Feld von `Query` und `Mutation` mit Ausnahme der Anmelde- und der Erneuerungs-Mutation und _für jeden_ Token-Defekt — kein Token, syntaktisch unlesbar, ungültige Signatur, Ablaufzeitpunkt um mehr als 60 Sekunden überschritten, keinem bestehenden Benutzerkonto zuordenbar — gilt: der Aufruf wird mit `UNAUTHENTICATED` abgelehnt, es werden keine Nutzerdaten zurückgegeben, und kein persistierter Datenbestand wird geändert.

**Validates: Requirements 2.10, 2.11**

### Property 30: Keine Abfrage überschreitet die Kontogrenze **[db]**

_Für jeden_ Datenbestand zweier Benutzerkonten und _für jede_ Abfrage oder Mutation mit dem Access-Token des einen Kontos gilt: das Ergebnis enthält ausschließlich Entitäten dieses Kontos, eine ausdrücklich angeforderte Entität des anderen Kontos wird als nicht vorhanden behandelt, es wird kein Feldwert dieser Entität zurückgegeben, und sie wird nicht geändert.

**Validates: Requirements 2.12, 2.15, 7.3**

**Abfrage von Katalog und Lernstand**

### Property 31: Die Katalogabfrage ist ordnungs- und feldtreu **[db]**

_Für jeden_ persistierten Katalog gilt: die zurückgegebenen Grammatik_Kategorien sind aufsteigend nach Busuu-Kennung geordnet, die Grammatik_Themen innerhalb einer Kategorie aufsteigend nach Sortierposition und bei gleicher Sortierposition aufsteigend nach Busuu-Kennung, und je Grammatik_Thema entsprechen Busuu-Kennung, Bezeichnung in `de` und `en`, Beschreibung in `de` und `en`, CEFR_Level und Sortierposition zeichen- beziehungsweise wertgleich den persistierten Feldern.

**Validates: Requirements 7.1, 7.2**

### Property 32: Ungeübte Themen bleiben im Ergebnis **[db]**

_Für jeden_ persistierten Katalog mit beliebiger Teilmenge vorhandener Lernstände gilt: ein Grammatik_Thema ist genau dann als Ungeübtes_Thema gekennzeichnet und ohne Lernstand-Wert, wenn zu ihm kein Lernstand des angemeldeten Benutzerkontos vorliegt, und die Menge der zurückgegebenen Grammatik_Themen ist unabhängig davon vollständig.

**Validates: Requirements 7.4**

### Property 33: Filter schneiden genau die durch das Prädikat bestimmte Teilmenge aus **[db]**

_Für jeden_ persistierten Katalog und _für jede_ Kombination aus Liste von CEFR_Level-Werten, Ausprägung des Lernstands-Filters und Einbeziehung nicht mehr im Katalog enthaltener Grammatik_Themen gilt: die Ergebnismenge ist genau die Menge der Grammatik_Themen, die alle gesetzten Prädikate erfüllen; eine fehlende Filterangabe bewirkt keine Einschränkung nach diesem Merkmal, und ohne ausdrückliche Anforderung sind keine als nicht mehr im Katalog enthalten gekennzeichneten Grammatik_Themen enthalten.

**Validates: Requirements 7.5, 7.6, 7.11**

### Property 34: Die Anzahl der Datenbankabfragen ist von der Ergebnisgröße unabhängig **[db]**

_Für jede_ Anzahl aufgelöster Grammatik_Kategorien gilt: die Anzahl der während der Auflösung ausgeführten Datenbankabfragen bleibt konstant und beträgt je Auflösungsebene höchstens eine, unabhängig von der Anzahl der Grammatik_Kategorien, der Grammatik_Themen und der Lernstände im Ergebnis.

**Validates: Requirements 7.7**

**Fehlerbehandlung und Nachvollziehbarkeit**

### Property 35: Jede Fehlerantwort trägt genau einen Code und keine internen Details **[rein]**

_Für jede_ Fehlerursache gilt: die Antwort trägt genau einen Fehlercode aus der geteilten Enumeration, eine Ursache ohne Zuordnung zu einem Enumerationswert ergibt `INTERNAL_SERVER_ERROR`, die Fehlermeldung enthält die Korrelationskennung und enthält keinen Aufrufstapel, keine Datenbankmeldung, keinen Dateipfad und keinen Hostnamen.

**Validates: Requirements 9.1, 9.3**

### Property 36: Eingabeverstöße werden mit Pfad benannt und wirken nicht **[db]**

_Für jede_ Eingabe einer Mutation, die die deklarierte Validierung in einer beliebigen Teilmenge ihrer Felder verletzt, gilt: die Operation wird mit `BAD_USER_INPUT` abgelehnt, die gemeldete Pfadmenge entspricht genau der Menge der verletzten Eingabefelder, und kein Datensatz wird angelegt oder geändert.

**Validates: Requirements 9.2**

### Property 37: Protokolleinträge eines Ingestion-Vorgangs sind zuordenbar **[db]**

_Für jeden_ fehlgeschlagenen Ingestion_Vorgang gilt: der Protokolleintrag benennt den fehlgeschlagenen Verarbeitungsschritt, enthält die Korrelationskennung und enthält die Kennung des zugehörigen Eintrags im Raw_Payload_Store, sofern ein solcher Eintrag vorliegt.

**Validates: Requirements 9.4**

### Property 38: Geheimnisse und Payload-Inhalte erscheinen in keinem Protokolleintrag **[rein]**

_Für jeden_ Ablauf mit beliebigen Werten für Zugangsdaten, Google_ID_Token, Sentenza_Access_Token, Sentenza_Refresh_Token und Payload-Inhalt gilt: kein erzeugter Protokolleintrag enthält einen dieser Werte als Teilzeichenkette, und anstelle des Payload-Inhalts erscheinen ausschließlich dessen Inhalts-Hash und dessen Größe.

**Validates: Requirements 9.5**

### Property 39: Korrelationskennungen sind eindeutig und durchgehend **[db]**

_Für jede_ Folge von Ingestion_Vorgängen gilt: die erzeugten Korrelationskennungen sind paarweise verschieden, und alle Protokolleinträge eines Vorgangs tragen dieselbe Kennung.

**Validates: Requirements 9.10**

### Property 40: Eine unvollständige Konfiguration verhindert den Start **[rein]**

_Für jede_ nicht-leere Teilmenge der benötigten Umgebungsvariablen gilt: fehlt diese Teilmenge in der Umgebung, bricht die Konfigurationsprüfung mit einem Fehler ab, der jeden fehlenden Variablennamen benennt, es wird kein Port geöffnet, und der Prozess endet mit einem von Null verschiedenen Exit-Code.

**Validates: Requirements 1.12**

**Chrome Extension**

### Property 41: Erfasst und übertragen wird genau das, was einem Muster entspricht **[rein]**

_Für jede_ abgefangene Antwort gilt: sie wird genau dann an den Hintergrunddienst weitergegeben und zur Übertragung eingereiht, wenn ihre Adresse einem der konfigurierten Muster entspricht, und die zugeordnete Payload-Art ist die dem getroffenen Muster zugeordnete; andernfalls wird der Antwortinhalt verworfen, nicht im lokalen Erweiterungsspeicher abgelegt und nicht übertragen. Jeder Eintrag der Warteschlange stammt aus einer Adresse mit Mustertreffer.

**Validates: Requirements 8.6, 8.13, 8.14**

### Property 42: Die Umhüllung verändert die Antwort an die Seite nicht **[rein]**

_Für jeden_ Antwortinhalt gilt: der Wert, den die umhüllten Schnittstellen `fetch` und `XMLHttpRequest` an die aufrufende Busuu-Seite zustellen, ist zeichengleich zu dem der nicht umhüllten Schnittstelle, und ein Fehler beim Auslesen des Inhalts ändert diesen Wert nicht.

**Validates: Requirements 8.7**

### Property 43: Der übertragene Inhalt ist zeichengleich zum erfassten **[rein]**

_Für jeden_ erfassten Antwortinhalt gilt: der über die Einreichungs-Mutation übertragene Inhalt ist zeichengleich zum erfassten Antwortinhalt, und die mitgesendete Payload-Art entspricht der bei der Erfassung zugeordneten.

**Validates: Requirements 8.8**

### Property 44: Die Warteschlange hält die jüngsten Erfassungen in Reihenfolge **[rein]**

_Für jede_ Folge von Erfassungen gilt: die Warteschlange im lokalen Erweiterungsspeicher enthält höchstens 50 Einträge und, sofern mehr erfasst wurden, genau die 50 jüngsten; die Abarbeitung nach einer erfolgreichen Anmeldung erfolgt in der Reihenfolge der Erfassung; ein erfolgreich übertragener Eintrag ist danach nicht mehr im Speicher, und der Zeitpunkt der letzten erfolgreichen Übertragung ist fortgeschrieben.

**Validates: Requirements 8.9, 8.11, 8.17**

### Property 45: Die Erneuerungsschwelle entscheidet über eine Vorab-Erneuerung **[rein]**

_Für jeden_ Ablaufzeitpunkt eines vorliegenden Sentenza_Access_Token gilt bei anstehender Übertragung: die Erneuerung über die Erneuerungs-Mutation wird genau dann und ohne Zutun des Nutzers ausgelöst, wenn die Restgültigkeit weniger als 60 Sekunden beträgt, und die Übertragung erfolgt anschließend mit dem neuen Sentenza_Access_Token.

**Validates: Requirements 8.4**

## Testing Strategy

### Werkzeuge und Ablage

- **Vitest** für Sentenza_Backend, Sentenza_Extension und jedes geteilte Paket; alle Läufe über die Turborepo-Aufgabe `test` in einem einmaligen Durchlauf ohne Beobachtungsmodus (`vitest run`). Requirement 10.1.
- Tests liegen in `__tests__` unmittelbar neben dem geprüften Quelltext und heißen `<name>.test.ts`, wobei `<name>` der Name der geprüften Quelldatei ohne Erweiterung ist. Requirement 10.2. Ein Meta-Test durchläuft die Quellverzeichnisse und schlägt fehl, wenn eine Testdatei diesem Muster nicht folgt.
- **fast-check** als Bibliothek für eigenschaftsbasierte Tests. Begründung: etablierte Wahl im TypeScript-Ökosystem, arbeitet nahtlos mit Vitest, minimiert Gegenbeispiele automatisch und gibt bei Fehlschlag Gegenbeispiel, `seed` und `path` aus — genau das, was Requirement 10.5 verlangt. Eigenschaftsbasiertes Testen wird nicht selbst gebaut.
- Jede Eigenschaft aus dem Abschnitt Correctness Properties wird durch **genau einen** eigenschaftsbasierten Test umgesetzt, mit `numRuns: 100` als Untergrenze und einem Kommentar in der festgelegten Form:

```ts
// Feature: backend-busuu-ingestion, Property 1: Round-Trip-Verlustfreiheit für Katalog-Payloads
it('normalisieren → serialisieren → normalisieren ist verlustfrei', async () => {
  await fc.assert(
    fc.asyncProperty(arbitraryCatalogPayload(), async (payload) => {
      /* ... */
    }),
    { numRuns: 100 },
  );
});
```

### Generatoren für die Round-Trip-Eigenschaften

Requirement 10.4 verlangt für beide Round-Trip-Eigenschaften mindestens 100 erzeugte, schemakonforme Eingaben je Durchlauf, die beide Kennungsformen, alle bekannten CEFR_Level-Werte, fehlende Übersetzungsschlüssel und leere Sammlungen abdecken. Die Generatoren liegen in `apps/backend/test/support/arbitraries.ts`.

```ts
const busuuId = (prefix: string) =>
  fc.oneof(
    fc.tuple(fc.constant(prefix), fc.constantFrom('es'), fc.nat({ max: 9 }), fc.nat({ max: 9 })).map(/* grammar_topic_es_1_3 */),
    fc.uuid().map((u) => `${prefix}_${u}`), // grammar_topic_3d4fa7b0-...
  );

const level = fc.oneof(
  fc.constantFrom('a1', 'A1', 'a2', 'b1', 'B2', 'c1'), // bekannte Werte, gemischte Schreibweise
  fc.constantFrom('', 'a0', 'zz', 'c2'),               // unbekannte Werte → UNBEKANNT
  fc.constant(undefined),                              // fehlendes Feld
  fc.constant(null),
);

const translationEntry = fc.oneof(
  fc.record({ value: fc.string({ minLength: 1 }) }),
  fc.record({ value: fc.constant(''), alternative_values: fc.array(fc.string(), { minLength: 1 }) }),
  fc.record({ alternative_values: fc.array(fc.string()) }),
  fc.constant(undefined), // Eintrag fehlt vollständig → Fallback auf den Schlüssel
);

const arbitraryCatalogPayload = () => /* Kategorien 0..5, Themen 0..8, structure mit Lücken in beide Richtungen,
   Wiederholungen in structure, translation_map mit fehlenden Schlüsseln, leere grammar_categories */;

const arbitraryProgressPayload = () => /* data 0..20 Einträge, topic_id bekannt/unbekannt/leer/fehlend,
   percentage 0, 100, dazwischen, außerhalb, nicht ganzzahlig, fehlend,
   strength 0, positiv, negativ, nicht ganzzahlig, fehlend, Dubletten derselben topic_id */;
```

Für die Round-Trip-Eigenschaften erzeugt der Generator ausschließlich **schemakonforme** Payloads; die ungültigen Achsen (fehlendes `percentage`, negative Stärke) gehören zu den Verwerfungs-Eigenschaften 20 und 5, nicht zum Round-Trip.

Der Vergleich zweier Bestände läuft über eine eigene Funktion `normalizedStateEquals(a, b)`, die nach Requirement 6.8 ausschließlich fachliche Schlüssel und fachliche Feldwerte vergleicht und technische Kennungen, `createdAt`, `updatedAt`, `firstSeenAt` und `lastSeenInCatalogAt` ausklammert. Diese Funktion wird selbst mit Beispieltests abgesichert — sonst könnte ein zu nachsichtiger Vergleich alle Round-Trip-Eigenschaften entwerten.

### Testdatenbank

- Bereitstellung über einen zweiten Dienst in `docker-compose.yml`: `postgres-test` auf Port 5433 mit eigenem Volume, angesprochen über `TEST_DATABASE_URL`.
- `apps/backend/test/global-setup.ts` prüft zuerst, dass die verwendete Verbindungszeichenkette gleich `TEST_DATABASE_URL` und ungleich `DATABASE_URL` ist, und bricht andernfalls ab. Danach läuft `prisma migrate deploy`, sodass der Ausgangszustand vollständig migriert ist. Requirement 10.7.
- Vor jedem Test setzt ein Helfer den Bestand zurück: ein `TRUNCATE … RESTART IDENTITY CASCADE` über alle Tabellen, deren Namen aus der Prisma-DMMF abgeleitet werden — damit vergisst der Reset keine neue Tabelle.
- Datenbankgestützte Eigenschaften führen den Reset innerhalb des Generatorlaufs aus (`beforeEach` je `fc`-Durchlauf über einen expliziten Aufruf), damit die 100 Durchläufe voneinander unabhängig sind.
- Alle datenbankgestützten Tests laufen in einer eigenen Vitest-Projektkonfiguration mit `pool: 'forks'` und `singleFork: true`, damit sich parallele Läufe nicht dieselbe Datenbank wegziehen.

### Attrappen und Netzabstinenz

- **Google-JWKS:** Ein im Test erzeugtes RSA-Schlüsselpaar (`jose`) liefert Tokens; der JWKS-Client wird durch eine Attrappe ersetzt, die den öffentlichen Schlüssel aus dem Speicher liefert und für den Zeitlimit-Fall eine Verzögerung simuliert. Es wird kein Google-Endpunkt kontaktiert. Requirement 10.9.
- **Extension:** `chrome.identity`, `chrome.storage`, `chrome.runtime` und `chrome.alarms` werden durch eigene, in `apps/extension/test/support/chrome-mock.ts` gehaltene Attrappen ersetzt; `chrome.storage.local` als Speicher-Attrappe mit tatsächlicher Persistenz innerhalb eines Tests. Zeitabhängige Abläufe (Wartezeiten 1, 4, 16 Sekunden) laufen über `vi.useFakeTimers()`.
- **Netzabstinenz:** Das Test-Setup ersetzt `globalThis.fetch` durch eine Funktion, die wirft, und installiert einen `undici`-`MockAgent` mit `disableNetConnect()`. Ein versehentlicher echter Aufruf zu Google oder Busuu macht den Lauf rot statt ihn heimlich langsam zu machen.

### Beispiel- und Kantenfalltests

Ergänzend zu den Eigenschaften, entsprechend Requirement 10.3 und 10.10:

- Je exportierter Funktion von Busuu_Normalizer und Auth_Service ein Test des erwarteten Ablaufs und ein Test einer in den Requirements beschriebenen Fehler- oder Verwerfungsbedingung. Ein Meta-Test gleicht die Exportlisten beider Module gegen die vorhandenen Testdateien ab, damit eine neue exportierte Funktion nicht unbemerkt ohne Test bleibt.
- Funktionen ohne beschriebene Fehlerbedingung erhalten mindestens einen Grenzfalltest mit leerer Eingabe oder fehlendem optionalem Feld.
- Kantenfälle ohne eigene Eigenschaft: JWKS nicht innerhalb von 5 Sekunden (2.13), unbekannte Payload-Art und leerer Inhalt (3.11), fehlende oder unbekannte Zielsprache in der Katalog-Query (7.9), leeres Abfrageergebnis (7.10), nicht abbildbarer Datensatz im Serializer (6.10), Abbruch und Zeitüberschreitung der Anmeldung in der Extension (8.15), fehlgeschlagene Erneuerung (8.16), Wiederholkette 1/4/16 Sekunden (8.10), Popup-Anzeige mit und ohne Werte (8.12), Datenbank nicht erreichbar im Health-Endpunkt (9.9).

### Integrations- und Struktur-Tests

- Hochfahren der Nest-Anwendung gegen die Testdatenbank: Port geöffnet, `schema.gql` erzeugt, Health-Endpunkt antwortet mit `database` (1.9, 9.7, 9.8).
- `prisma migrate deploy` auf leerer Datenbank, danach `prisma migrate diff` gegen `schema.prisma` muss leer sein (1.10).
- Strukturtests: keine Wildcard-Host-Berechtigung im Manifest (8.1); kein Modul unter `src/**` importiert den Serializer und `schema.gql` enthält kein Serializer-Feld (6.9); keine erneute Deklaration einer geteilten Enumeration in `apps/**` (1.4); Schlüsselmenge von `.env.example` gleich der Schlüsselmenge des Konfigurationsschemas (1.8).

### Fixtures

Die beiden unveränderten Beispielpayloads liegen unter `fixtures/busuu/progress.json` und `fixtures/busuu/grammar-review-es.json` und werden in den Tests von Busuu_Normalizer verwendet (Requirement 10.8): Der Katalog-Payload muss vollständig normalisieren, 19 Kategorien und 134 Grammatik_Themen erzeugen, alle fünf bekannten CEFR_Level abdecken und die vier Übersetzungseinträge mit `alternative_values` korrekt auflösen; der Lernstands-Payload muss 8 Lernstände zu Themen erzeugen, die im Katalog-Fixture vorhanden sind. Zusätzlich prüft ein eigener Test Byte-Größe und SHA-256 beider Dateien gegen hinterlegte Werte und schlägt fehl, sobald ein Formatierungswerkzeug sie angetastet hat.

### Reihenfolge

Vor jedem Abschluss einer Aufgabe: `format` → `lint` → `check-types` → `build` → `test`. Ein Fehlschlag in `test` endet mit einem von Null verschiedenen Exit-Code, benennt Testdatei und Testnamen und zeigt die Abweichung zwischen erwartetem und beobachtetem Wert (Requirement 10.11).

## Risk Assessment

| Risiko                                                                                                                                                                                                           | Auswirkung                                                                                                                                                              | Gegenmaßnahme                                                                                                                                                                                                                                                                                                                                                                                                | Restrisiko                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Busuu ändert Format oder Endpunkte.** Es gibt keine offizielle API, keine Zugangsdaten und keine Stabilitätszusage; die Daten fallen als Nebenprodukt der normalen Nutzung an.                                 | Normalisierung bricht ab oder verliert Felder; Erfassung greift ins Leere.                                                                                              | Schema-Validierung vor dem ersten Schreibvorgang mit Nennung des verletzten Pfads; rohe Payloads dauerhaft aufbewahrt, sodass eine angepasste Normalisierung nachträglich auf den vorhandenen Bestand laufen kann; unbekannte Feldpfade werden protokolliert statt verworfen.                                                                                                                                | Eine Formatänderung bleibt eine manuelle Nacharbeit. Der Datenverlust ist auf den Zeitraum bis zur Anpassung begrenzt, nicht auf die Payloads selbst. |
| **Umhüllung von `fetch` und `XMLHttpRequest` ist fragil.** Sie hängt am Frontend-Verhalten von Busuu; ein Wechsel der HTTP-Bibliothek, ein Service Worker der Seite oder Streaming-Antworten können sie umgehen. | Antworten werden nicht mehr erfasst, ohne dass es auffällt.                                                                                                             | Popup zeigt den Zeitpunkt der letzten erfolgreichen Übertragung, sodass ein Ausbleiben sichtbar wird; jeder Ausleseversuch steht in `try/catch` und lässt die Seite unberührt; die Muster für die Endpunkte liegen als Konfiguration und nicht im Code verstreut.                                                                                                                                            | Eine stille Nicht-Erfassung bleibt möglich. Es gibt in diesem Spec keine Überwachung, die aktiv warnt.                                                |
| **Beendigung des MV3-Service-Workers.** Chrome beendet den Worker nach kurzer Untätigkeit; laufende Übertragungen und Wiederholungs-Timer gehen dabei verloren.                                                  | Eine Erfassung bleibt liegen oder wird doppelt übertragen.                                                                                                              | Der gesamte Zustand liegt in `chrome.storage.local`, nicht im Speicher; `attemptCount` und `nextAttemptAt` je Eintrag; ein `chrome.alarms`-Wecker arbeitet die Warteschlange nach jedem Neustart erneut ab; Doppelübertragung ist durch Requirement 3.7 und die Idempotenz der Normalisierung unschädlich.                                                                                                   | Bei sehr kurzen Browsersitzungen können Einträge länger in der Warteschlange verweilen als gewünscht.                                                 |
| **Eigene JWT-Ausstellung statt Auth0.** Schlüsselverwaltung, Ablauf und Widerruf liegen im Projekt.                                                                                                              | Ein kompromittiertes `JWT_SECRET` erlaubt das Fälschen beliebiger Access-Tokens; ein Fehler im Widerruf hebt ihn stillschweigend aus.                                   | Refresh-Tokens sind opak und nur als SHA-256-Hash gespeichert, damit ein Datenbankleck keine verwendbaren Tokens preisgibt; Widerruf über `revokedAt`; kurze Access-Token-Gültigkeit (Vorgabe 15 Minuten); Freigabeliste als zweite Schranke, die auch bei jeder Erneuerung greift; `passport-jwt` und `jwks-rsa` bleiben in Verwendung, sodass ein Wechsel auf Auth0 im Wesentlichen den Issuer austauscht. | Das Signaturgeheimnis liegt lokal in `.env`. Eine Rotation ist in diesem Spec nicht vorgesehen.                                                       |
| **Größe des Katalog-Payloads gegen die 10-MiB-Grenze.** Der beobachtete Katalog-Payload liegt bei knapp 92 KiB, also etwa 0,9 % der Grenze, bei 19 Kategorien, 134 Themen und 306 Übersetzungseinträgen.         | Bei einem Vielfachen an Zielsprachen oder einer erweiterten Übersetzungskarte könnte eine künftige Antwort die Grenze reißen und mit `BAD_USER_INPUT` abgelehnt werden. | Die Grenze ist über `INGESTION_MAX_PAYLOAD_BYTES` konfigurierbar; der Inhalt wird als `text`-Spalte ohne eigene Längenbegrenzung gespeichert; die Ablehnung nennt die Größe, sodass der Fall erkennbar ist.                                                                                                                                                                                                  | Ein Anheben der Grenze verschiebt die Last in die Datenbank und in den Speicherbedarf der Verarbeitung. Es gibt keinen Streaming-Pfad.                |
| **Formatierungswerkzeuge verändern die Fixtures unbemerkt.** Beim Anlegen des Katalog-Fixtures ist das bereits einmal passiert.                                                                                  | Größe und Inhalts-Hash verschieben sich; die Round-Trip-Tests prüfen dann nicht mehr das echte Busuu-Format.                                                            | `fixtures/` steht in `.prettierignore` und in den ESLint-Ignores; ein Test vergleicht Byte-Größe und SHA-256 beider Dateien gegen hinterlegte Werte und schlägt bei jeder Änderung fehl.                                                                                                                                                                                                                     | Ein bewusstes Aktualisieren der hinterlegten Hashwerte umgeht die Schranke. Das bleibt eine Frage der Aufmerksamkeit im Review.                       |
| **Verlustfreiheit hängt an der Vergleichsfunktion.** `normalizedStateEquals` entscheidet, was „identisch" heißt.                                                                                                 | Ein zu nachsichtiger Vergleich lässt alle Round-Trip-Eigenschaften grün werden, obwohl Felder verloren gehen.                                                           | Die Vergleichsfunktion ist selbst mit Beispieltests belegt, in beiden Richtungen: gleiche Bestände mit abweichenden technischen Kennungen gelten als gleich, Bestände mit einem abweichenden fachlichen Feldwert ausdrücklich nicht.                                                                                                                                                                         | Ein neu hinzugefügtes fachliches Feld, das im Vergleich vergessen wird, fällt nicht auf. Beim Erweitern des Modells mitzupflegen.                     |
| **Erfassung eigener Busuu-Antworten und Nutzungsbedingungen.** Die Extension liest Antworten mit, die für die Busuu-Webanwendung bestimmt sind.                                                                  | Nutzungsbedingungen und rechtliche Rahmenbedingungen können dem Mitlesen entgegenstehen.                                                                                | Sachliche Einordnung ohne juristische Bewertung: erfasst werden ausschließlich die Daten des eigenen Kontos, ausschließlich Antworten der beiden konfigurierten Endpunkte, der Betrieb ist rein lokal, es gibt keine Weitergabe an Dritte und keinen Massenabruf; Host-Berechtigungen sind auf die Busuu-Domänen und die eigene Backend-Adresse beschränkt.                                                  | Die Bewertung durch Busuu bleibt offen. Sie sollte vor jeder Veröffentlichung der Extension geklärt werden.                                           |
| **Zielsprache eines Lernstands-Payloads ist nicht im Payload enthalten.** Der Entwurf greift auf `DEFAULT_TARGET_LANGUAGE` zurück.                                                                               | Käme irgendwann eine zweite Lernsprache dazu, würden neu angelegte Themen aus Lernstands-Payloads der falschen Sprache zugeordnet.                                      | Themensuche erfolgt sprachunabhängig über die Busuu-Kennung, die in der Praxis global eindeutig ist; die Vorgabe ist konfigurierbar; ein solches Thema ist als nicht im Katalog enthalten gekennzeichnet und damit erkennbar.                                                                                                                                                                                | Bei mehreren Lernsprachen braucht es eine echte Sprachangabe. Das verlangt eine Änderung der Einreichungs-Schnittstelle.                              |
| **Laufzeit der Testsuite.** Zahlreiche Eigenschaften laufen mit mindestens 100 Durchläufen gegen eine echte Datenbank, jeweils mit Reset.                                                                        | Die Aufgabe `test` wird langsam und damit seltener ausgeführt.                                                                                                          | Reine Eigenschaften (Auflösung der Übersetzungsschlüssel, CEFR-Abbildung, Mustererkennung, Warteschlange, Redaction, Fehlerformatierung) laufen ohne Datenbank; datenbankgestützte Eigenschaften nutzen `TRUNCATE` statt einer Neumigration je Durchlauf und erzeugen bewusst kleine Payloads (0–5 Kategorien, 0–8 Themen).                                                                                  | Die Suite bleibt deutlich langsamer als eine reine Unit-Test-Suite. Eine Aufteilung in schnelle und langsame Projekte kann später nötig werden.       |
