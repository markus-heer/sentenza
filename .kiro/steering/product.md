# Sentenza

## Zweck

Sentenza ist eine Anwendung, die das aktive Schreiben spanischer Sätze fördert. Es ist ein Einzelnutzer-Projekt: Der Nutzer ist deutscher Muttersprachler und lernt Spanisch.

## Kernidee

Nicht passives Wiedererkennen, sondern aktives Produzieren. Dafür sind zwei Übungsarten vorgesehen:

1. **Übersetzung**: Ein deutscher Satz wird vorgelegt, der Nutzer übersetzt ihn ins Spanische.
2. **Freies Schreiben**: Eine Schreibaufgabe zu einem Thema, das mit dem aktuellen Sprachniveau bewältigbar ist.

## Korrekturen

Korrekturen erfolgen immer über Claude Opus (Anthropic API). Das ist eine feste Produktentscheidung, kein Implementierungsdetail.

## Personalisierung

Die Aufgaben richten sich nach zwei Quellen:

- **Busuu-Grammatik-Lernstand**: welche Grammatikthemen der Nutzer wie gut beherrscht, inklusive CEFR-Niveau je Thema.
- **Eigene Vokabeln**: die Vokabeln, die der Nutzer in der App selbst lernt.

## Vokabeln

Vokabeln werden in einem eigenen, in die App eingebauten Vokabeltrainer nach dem 5-Kammer-Prinzip (Leitner-System) verwaltet: fünf Kammern, eine richtig beantwortete Vokabel wandert eine Kammer weiter, eine falsch beantwortete zurück in Kammer 1.

Es gibt ausdrücklich **keinen** Import aus Anki. Ein früher erwogener Anki-Import wurde verworfen.

## Bestandteile des Zielbilds

1. **Backend**: Node/NestJS mit GraphQL, Prisma, PostgreSQL.
2. **Chrome Extension**: fängt die Antworten des Busuu-Grammatiktrainers im Browser ab und überträgt sie ans Backend; Anmeldung per Google.
3. **Flutter-App**: die Schreibübungen und der Vokabeltrainer, Anmeldung per Google OAuth.

## Umsetzungsreihenfolge (Specs)

Zuerst das Fundament: Backend, Chrome Extension, Google-Anmeldung sowie Aufnahme und Normalisierung der Busuu-Daten.

Danach in eigenen, späteren Specs:

- die Flutter-App mit den Schreibübungen,
- der Vokabeltrainer nach dem 5-Kammer-Prinzip,
- die Anthropic-/Claude-Integration für Aufgabengenerierung und Korrektur,
- Live-Infrastruktur und Deployment.

## Betriebsmodell aktuell

Alles läuft ausschließlich lokal. Live-Infrastruktur folgt später und soll sich am Vorbild des Repositories `aos-metaforge` orientieren (Terraform, Docker, GitHub Actions, AWS).
