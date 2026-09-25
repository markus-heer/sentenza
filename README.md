# Sentenza

Sentenza fördert aktives Schreiben spanischer Sätze. Dieses Repository enthält das lokal betriebene Fundament: das NestJS-Backend (code-first GraphQL, Prisma, PostgreSQL) und die Chrome Extension als Datenquelle.

## Lokal starten

Fünf Befehle aus einem frisch geklonten Repository bis zur antwortenden GraphQL_API:

```sh
cp .env.example .env
docker compose up -d postgres postgres-test
pnpm install
pnpm --filter @sentenza/backend db:migrate:deploy
pnpm --filter @sentenza/backend start:dev
```

`pnpm install` generiert über das `postinstall`-Skript den Prisma-Client (keine erreichbare Datenbank nötig). `start:dev` erzeugt `apps/backend/schema.gql` und öffnet den in `.env` unter `PORT` konfigurierten Port (Vorgabe `4000`).
