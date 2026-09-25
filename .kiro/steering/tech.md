# Technik

## Stack

- **Monorepo**: Turborepo mit pnpm-Workspaces. Interne Pakete werden über `workspace:*` referenziert.
- **Backend**: NestJS mit code-first GraphQL (Apollo Server), Prisma, PostgreSQL. TypeScript strict. Tests mit Vitest.
- **Chrome Extension**: Manifest V3, TypeScript, Tests mit Vitest.
- **App**: Flutter (eigenes, späteres Spec).
- **Datenbank lokal**: über `docker-compose`.

## Bewusste Abweichungen vom globalen Standards-Steering-File

- **Auth ohne Auth0.** Das globale Steering-File schreibt Auth0 plus JWT vor. Sentenza verwendet stattdessen Google OAuth 2.0 / OIDC direkt: Das Backend prüft Google-ID-Tokens gegen die von Google veröffentlichten JWKS und stellt eigene Access- und Refresh-JWTs aus. Grund: Die lokale MVP-Kette soll ohne externen Tenant lauffähig sein. `passport-jwt` und `jwks-rsa` bleiben in Verwendung, sodass ein späterer Wechsel auf Auth0 im Wesentlichen nur den Issuer austauscht.
- **Frontend ist Flutter, nicht React.** Das globale Steering-File beschreibt React mit Vite und Playwright. Für die App gilt stattdessen Flutter; die dort genannten React-, Apollo-Client- und Playwright-Vorgaben sind auf Sentenza nicht anwendbar. Die Vorgaben zu TypeScript, Prettier, ESLint, Vitest, Prisma und GraphQL gelten unverändert für Backend, Extension und geteilte Pakete.
- Alles Übrige aus dem globalen Steering-File gilt unverändert, insbesondere: `schema.gql` und der Prisma-Client sind generiert und werden nie handisch bearbeitet, Migrationen für jede Schemaänderung, DataLoader gegen N+1, geteilte Domänentypen und Enumerationen in eigenen Paketen, Tests in `__tests__/<name>.test.ts`, Reihenfolge Format → Lint → Type-Check → Build → Test.

## Zugriffsschutz

- Einzelnutzer-System. Der Zugriff wird zusätzlich über eine Freigabeliste von Google-E-Mail-Adressen begrenzt, konfiguriert per Umgebungsvariable. Ohne diese Liste könnte jedes beliebige Google-Konto in die Datenbank schreiben.
- Jede persistierte Entität mit Nutzerdaten wird genau einem Benutzerkonto zugeordnet; Abfragen geben ausschließlich Entitäten des angemeldeten Kontos zurück.

## Umgang mit Fremddaten

- Rohe Busuu-Payloads werden unverändert und dauerhaft aufbewahrt, bevor normalisiert wird. Damit lässt sich die Normalisierung nach einem Fehler oder einer Modelländerung erneut ausführen, ohne die Daten erneut bei Busuu abzuholen.
- Der normalisierte Lernstand wird je Grammatikthema überschrieben; es gibt keine normalisierte Zeitreihe. Eine Historie lässt sich bei Bedarf aus den rohen Payloads rekonstruieren.
- Die Normalisierung der Busuu-Payloads wird durch eigenschaftsbasierte Round-Trip-Tests abgesichert (Normalisieren, Serialisieren, erneut Normalisieren muss denselben Datenbestand ergeben). Der Serializer existiert ausschließlich zu diesem Prüfzweck und ist über die GraphQL-Schnittstelle nicht erreichbar.

## Betrieb

- Aktuell ausschließlich lokal. Live-Infrastruktur, Deployment und CI folgen in einem eigenen Spec und sollen dem Vorbild des Repositories `aos-metaforge` entsprechen (Terraform mit remote State, mehrstufige Docker-Builds, GitHub Actions, AWS).
