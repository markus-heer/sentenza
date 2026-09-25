# Requirements Document

## Introduction

Sentenza ist eine Anwendung, die das aktive Schreiben spanischer Sätze fördert. Übungen werden später anhand des Busuu-Grammatik-Lernstands und der in der Schreib-App selbst verwalteten Vokabeln des Nutzers personalisiert; Korrekturen erfolgen über die Anthropic-API (Claude Opus).

Dieses Spec umfasst ausschließlich das **Fundament**: das lokal betriebene Backend (NestJS, code-first GraphQL, Prisma, PostgreSQL) im Turborepo-Monorepo, die Anmeldung mit Google sowie die Chrome Extension als einzige Datenquelle, ohne die kein Datensatz ins Backend gelangt.

**Ausdrücklich nicht im Scope dieses Specs:**

- Die Flutter-App und die Schreibübungen selbst (eigenes, späteres Spec).
- Der in die Flutter-App eingebaute Vokabeltrainer nach dem 5-Kammer-Prinzip (Leitner-System: fünf Kammern, eine richtig beantwortete Vokabel wandert eine Kammer weiter, eine falsch beantwortete zurück in Kammer 1). Dort entstehen künftig die Vokabeln, mit denen Übungen personalisiert werden; Datenmodell und Schnittstellen dafür werden in einem eigenen, späteren Spec entworfen.
- Die Anthropic-/Claude-Integration, also Aufgabengenerierung und Korrektur (eigenes, späteres Spec).
- Live-Infrastruktur und Deployment (Terraform, AWS, GitHub Actions) — folgt in einem späteren Spec nach dem Vorbild von `aos-metaforge`.

**Festgelegte Grundsatzentscheidungen** (mit dem Nutzer abgestimmt):

| Thema               | Entscheidung                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anmeldung           | Google OAuth 2.0 / OIDC **direkt**, ohne Auth0. Das Backend prüft Google-ID-Tokens und stellt eigene JWTs aus. Bewusste Abweichung vom Steering-File, um die lokale MVP-Kette ohne externen Tenant lauffähig zu halten; `passport-jwt` und `jwks-rsa` bleiben in Verwendung, sodass ein späterer Wechsel auf Auth0 nur den Issuer austauscht. |
| Chrome Extension    | Minimal im Scope: Google-Anmeldung, Abfangen der Busuu-Antworten, Upload, Statusanzeige. Einzige Datenquelle dieses Specs.                                                                                                                                                                                                                    |
| Lernstands-Historie | Keine normalisierte Zeitreihe. Der normalisierte Lernstand wird je Grammatik-Thema überschrieben. Die **rohen Payloads** werden dauerhaft aufbewahrt, sodass sich eine Historie bei Bedarf später rekonstruieren lässt.                                                                                                                       |
| Vokabeln            | Kein Import aus Anki. Vokabeln werden später im eigenen Vokabeltrainer der Flutter-App nach dem 5-Kammer-Prinzip (Leitner-System) verwaltet und in einem eigenen Spec entworfen.                                                                                                                                                              |

**Zur Notation:** Die EARS-Schlüsselwörter (WHEN, WHILE, IF/THEN, WHERE, THE, SHALL) stehen englisch und in Großbuchstaben, der Inhalt der Anforderungen auf Deutsch.

## Glossary

### Systeme und Komponenten

- **Sentenza**: Das Gesamtprodukt aus dem Backend, der Chrome Extension und der späteren Schreib-App mit eigenem Vokabeltrainer.
- **Sentenza_Backend**: Der NestJS-Server mit code-first GraphQL-Schnittstelle, Prisma und PostgreSQL. Übergeordneter Name für alle serverseitigen Komponenten.
- **GraphQL_API**: Die von Sentenza_Backend bereitgestellte GraphQL-Schnittstelle (Queries und Mutations).
- **Auth_Service**: Die Komponente von Sentenza_Backend, die Google-ID-Tokens prüft, Benutzerkonten anlegt und Sentenza-Tokens ausstellt und validiert.
- **Ingestion_Service**: Die Komponente von Sentenza_Backend, die eingereichte Payloads annimmt, im Raw_Payload_Store ablegt und die Normalisierung anstößt.
- **Raw_Payload_Store**: Die Persistenzschicht für unveränderte, eingereichte Payloads samt Metadaten.
- **Busuu_Normalizer**: Die Komponente von Sentenza_Backend, die rohe Busuu-Payloads in das normalisierte Datenmodell überführt.
- **Busuu_Serializer**: Die Komponente von Sentenza_Backend, die normalisierte Busuu-Daten zurück in die Struktur eines Busuu-Payloads überführt. Dient der Round-Trip-Prüfung.
- **Sentenza_Extension**: Die Chrome Extension (Manifest V3), die Busuu-Antworten im Browser abfängt und an Sentenza_Backend überträgt.
- **Sentenza_Monorepo**: Das Turborepo-Repository mit pnpm-Workspaces, das alle genannten Komponenten und geteilten Pakete enthält.

### Fachbegriffe

- **Google_ID_Token**: Ein von Google ausgestelltes, signiertes OIDC-JWT, das die Identität eines Google-Kontos belegt.
- **Sentenza_Access_Token**: Ein von Auth_Service ausgestelltes, kurzlebiges JWT zur Autorisierung von GraphQL_API-Aufrufen.
- **Sentenza_Refresh_Token**: Ein von Auth_Service ausgestelltes, langlebiges Token zur Erneuerung eines Sentenza_Access_Token ohne erneute Google-Anmeldung.
- **Konto_Freigabeliste**: Die konfigurierte Liste der Google-E-Mail-Adressen, die Sentenza nutzen dürfen.
- **Zielsprache**: Die von Sentenza unterstützte Lernsprache, abgeleitet aus der Katalog-Kennung (Beispiel: `grammar_review_es` ergibt Spanisch).
- **Grammatik_Katalog**: Der vollständige, von Busuu gelieferte Bestand an Grammatik-Kategorien und Grammatik-Themen einer Zielsprache.
- **Grammatik_Kategorie**: Eine Gruppierung von Grammatik-Themen im Grammatik_Katalog, identifiziert durch eine Busuu-Kennung (Beispiele: `grammar_category_es_1`, `grammar_category_d2e53328-...`).
- **Grammatik_Thema**: Ein einzelnes Grammatikthema im Grammatik_Katalog, identifiziert durch eine Busuu-Kennung (Beispiele: `grammar_topic_es_1_3`, `grammar_topic_3d4fa7b0-...`).
- **Übersetzungsschlüssel**: Eine Zeichenkette mit dem Präfix `str_`, die in den Inhaltsfeldern eines Busuu-Payloads anstelle des Klartexts steht.
- **Übersetzungskarte**: Das Feld `translation_map` eines Busuu-Payloads, das Übersetzungsschlüssel auf Klartext je Sprache abbildet.
- **CEFR_Level**: Das Niveau eines Grammatik_Thema nach dem europäischen Referenzrahmen. Bekannte Werte: `a1`, `a2`, `b1`, `b2`, `c1`. Zusätzlich persistierbar ist der Wert `UNBEKANNT` für ein Grammatik_Thema, dessen Niveau sich aus dem Payload nicht auf einen bekannten Wert abbilden lässt.
- **Lernstand**: Der von Busuu gemeldete Fortschritt zu einem Grammatik_Thema, bestehend aus Stärke und Prozentwert.
- **Stärke**: Der Wert des Busuu-Felds `strength`, eine nicht-negative ganze Zahl.
- **Prozentwert**: Der Wert des Busuu-Felds `percentage`, eine ganze Zahl zwischen 0 und 100.
- **Ungeübtes_Thema**: Ein Grammatik_Thema, das im Grammatik_Katalog enthalten ist, für das aber kein Lernstand vorliegt.
- **Ingestion_Vorgang**: Eine einzelne Einreichung von Daten durch Sentenza_Extension an GraphQL_API.
- **Idempotenz**: Die Eigenschaft, dass die mehrfache Verarbeitung desselben Payloads denselben normalisierten Datenbestand ergibt wie die einmalige Verarbeitung.
- **Payload-Art**: Die Kennzeichnung der Struktur eines eingereichten Payloads, angegeben als Wert aus der festgelegten Liste der unterstützten Payload-Arten. Unterstützt werden Katalog-Payload und Lernstands-Payload.
- **Katalog-Payload**: Ein roher Busuu-Payload, der den Grammatik_Katalog einer Zielsprache mit `grammar_categories`, `grammar_topics` und Übersetzungskarte liefert.
- **Lernstands-Payload**: Ein roher Busuu-Payload, der den Lernstand je Grammatik_Thema unter `data` liefert.
- **Quelle der Einreichung**: Die Angabe, welcher Client einen Payload eingereicht hat. Einziger in diesem Spec unterstützter Wert ist Sentenza_Extension; das Feld bleibt als Erweiterungspunkt für künftige Clients bestehen.
- **Inhalts-Hash**: Ein über den unveränderten Payload-Inhalt berechneter Prüfwert, der eine Einreichung ohne Wiedergabe des Payload-Inhalts wiedererkennbar macht.
- **Verarbeitungszustand**: Der Stand der Normalisierung eines Eintrags im Raw_Payload_Store mit den Werten `VERARBEITET` (ohne Fehler und ohne verworfene Einträge abgeschlossen), `TEILWEISE_VERARBEITET` (abgeschlossen, mindestens ein Eintrag verworfen) und `FEHLGESCHLAGEN` (abgebrochen, keine Änderung am normalisierten Datenbestand).
- **Korrelationskennung**: Eine je Ingestion_Vorgang eindeutige Kennung, die allen Protokolleinträgen dieses Ingestion_Vorgangs mitgegeben und dem Client in Fehlermeldungen zurückgegeben wird.

## Requirements

### Requirement 1: Lokal lauffähiges Monorepo-Grundgerüst

**User Story:** Als Entwickler möchte ich das gesamte System mit wenigen Befehlen lokal starten und prüfen können, damit ich ohne Cloud-Abhängigkeiten an Sentenza arbeiten kann.

#### Acceptance Criteria

1. THE Sentenza_Monorepo SHALL Turborepo mit pnpm-Workspaces verwenden und jede Abhängigkeit zwischen zwei Workspace-Paketen ausschließlich über den Spezifizierer `workspace:*` auflösen, sodass kein Quelldatei-Import eines Workspace-Pakets auf einen relativen Pfad außerhalb des eigenen Paketverzeichnisses verweist.
2. THE Sentenza_Monorepo SHALL die Turborepo-Aufgaben `format`, `lint`, `check-types`, `build` und `test` bereitstellen, die jeweils über alle Workspace-Pakete ausgeführt werden und deren Aufgabenabhängigkeiten im Turborepo-Aufgabengraphen so deklariert sind, dass `build`, `check-types` und `test` eines Pakets erst nach dem `build` aller Pakete laufen, von denen es abhängt.
3. THE Sentenza_Monorepo SHALL geteilte ESLint- und TypeScript-Konfigurationen in je einem eigenen Workspace-Paket bereitstellen, auf das jede Anwendung und jedes Paket über den Workspace-Spezifizierer verweist, ohne diese Regeln erneut lokal zu deklarieren.
4. THE Sentenza_Monorepo SHALL Domänentypen und Enumerationen, die von mehr als einer Anwendung verwendet werden, in genau einem geteilten Workspace-Paket bereitstellen, sodass keine Anwendung denselben Typ oder dieselbe Enumeration erneut deklariert.
5. THE Sentenza_Monorepo SHALL eine `docker-compose`-Definition bereitstellen, die eine PostgreSQL-Instanz startet, die innerhalb von höchstens 60 Sekunden nach dem Start Verbindungen annimmt und deren Datenbestand einen Neustart des Containers unverändert übersteht.
6. WHEN das `postinstall`-Skript des Sentenza_Monorepo ausgeführt wird, THE Sentenza_Monorepo SHALL den Prisma-Client aus `schema.prisma` neu generieren, ohne dass dafür eine erreichbare PostgreSQL-Instanz erforderlich ist.
7. THE Sentenza_Backend SHALL TypeScript im Strict-Modus verwenden und ohne Fehler und ohne Warnungen durch `tsc --noEmit` übersetzbar sein.
8. THE Sentenza_Monorepo SHALL eine Datei `.env.example` enthalten, die jede von Sentenza_Backend oder Sentenza_Extension gelesene Umgebungsvariable mit Namen und einem Platzhalterwert aufführt und keinen echten Zugangsdatenwert enthält.
9. WHEN Sentenza_Backend lokal gestartet wird und die konfigurierte PostgreSQL-Instanz Verbindungen annimmt, THE GraphQL_API SHALL innerhalb von höchstens 60 Sekunden auf dem über eine in `.env.example` dokumentierte Umgebungsvariable konfigurierten Port Anfragen annehmen und das code-first erzeugte GraphQL-Schema als Datei `schema.gql` im Repository ablegen.
10. THE Sentenza_Backend SHALL `schema.prisma` als einzige Quelle der Datenbankstruktur führen und jede Änderung daran über eine versionierte, im Repository eingecheckte Prisma-Migration abbilden, sodass ein Lauf der Migrationen auf einer leeren Datenbank denselben Stand ergibt wie `schema.prisma`.
11. THE Sentenza_Monorepo SHALL eine Befehlsfolge von höchstens fünf Einzelbefehlen dokumentieren, die aus einem frisch geklonten Repository heraus die PostgreSQL-Instanz startet, die Abhängigkeiten installiert, die Migrationen anwendet und Sentenza_Backend so startet, dass die GraphQL_API Anfragen annimmt.
12. IF beim Start von Sentenza_Backend eine in `.env.example` als benötigt aufgeführte Umgebungsvariable fehlt oder die konfigurierte PostgreSQL-Instanz nicht innerhalb von 60 Sekunden erreichbar ist, THEN THE Sentenza_Backend SHALL den Start mit einer Fehlermeldung abbrechen, die die fehlende Variable beziehungsweise die fehlgeschlagene Datenbankverbindung benennt, keinen Port öffnen und einen von Null verschiedenen Exit-Code zurückgeben.
13. IF eine der Turborepo-Aufgaben `format`, `lint`, `check-types`, `build` oder `test` oder das `postinstall`-Skript in einem Workspace-Paket fehlschlägt, THEN THE Sentenza_Monorepo SHALL den Vorgang mit einem von Null verschiedenen Exit-Code beenden und in der Ausgabe das betroffene Workspace-Paket und die betroffene Aufgabe benennen.

### Requirement 2: Anmeldung mit Google und Absicherung der Schnittstelle

**User Story:** Als Nutzer möchte ich mich mit meinem Google-Konto anmelden, damit nur ich Daten in mein Sentenza-Backend einspeisen und abfragen kann.

#### Acceptance Criteria

1. WHEN ein Client ein Google_ID_Token an die Anmelde-Mutation von GraphQL_API übergibt, THE Auth_Service SHALL die Signatur des Google_ID_Token gegen den anhand der Schlüsselkennung des Tokens ausgewählten Schlüssel der von Google veröffentlichten JWKS prüfen und den Abruf der JWKS nach höchstens 5 Sekunden abbrechen.
2. WHEN ein Google_ID_Token geprüft wird, THE Auth_Service SHALL zusätzlich zur Signatur prüfen, dass `iss` der konfigurierten Google-Issuer-Kennung entspricht, dass `aud` der konfigurierten Google-Client-Kennung entspricht, dass `exp` mit einer Toleranz von höchstens 60 Sekunden in der Zukunft liegt und dass `email_verified` den Wert `true` hat.
3. IF die Prüfung eines Google_ID_Token fehlschlägt, weil das Token syntaktisch unlesbar ist, die Signatur nicht verifizierbar ist, kein passender Schlüssel in den JWKS vorliegt, einer der Ansprüche `iss`, `aud` oder `email_verified` nicht dem erwarteten Wert entspricht oder `exp` erreicht ist, THEN THE Auth_Service SHALL die Anmeldung mit dem Fehlercode `UNAUTHENTICATED` ablehnen, kein Sentenza_Access_Token und kein Sentenza_Refresh_Token ausstellen und kein Benutzerkonto anlegen oder ändern.
4. IF die im Google_ID_Token enthaltene E-Mail-Adresse, verglichen in Kleinbuchstaben und ohne umgebende Leerzeichen, nicht in der Konto_Freigabeliste enthalten ist, THEN THE Auth_Service SHALL die Anmeldung oder Erneuerung mit dem Fehlercode `FORBIDDEN` ablehnen, kein Benutzerkonto anlegen und kein Sentenza_Access_Token und kein Sentenza_Refresh_Token ausstellen.
5. WHEN ein Google_ID_Token erfolgreich geprüft wurde und die E-Mail-Adresse in der Konto_Freigabeliste enthalten ist, THE Auth_Service SHALL in derselben Antwort ein Sentenza_Access_Token und ein Sentenza_Refresh_Token mit einer Gültigkeitsdauer von 30 Tagen sowie die Ablaufzeitpunkte beider Token zurückgeben.
6. WHEN ein Sentenza_Access_Token ausgestellt wird, THE Auth_Service SHALL dessen Gültigkeitsdauer auf einen konfigurierbaren Wert zwischen 5 und 60 Minuten setzen, mit 15 Minuten als Vorgabewert.
7. WHEN sich ein Google-Konto erstmals erfolgreich anmeldet, dessen Google-Subject-Kennung keinem Benutzerkonto zugeordnet ist, THE Auth_Service SHALL genau ein Benutzerkonto mit der Google-Subject-Kennung als eindeutigem Schlüssel und mit der E-Mail-Adresse aus dem Google_ID_Token anlegen.
8. WHEN sich ein Google-Konto anmeldet, dessen Google-Subject-Kennung bereits einem Benutzerkonto zugeordnet ist, THE Auth_Service SHALL das bestehende Benutzerkonto verwenden, kein zweites Benutzerkonto anlegen und die gespeicherte E-Mail-Adresse auf den Wert aus dem Google_ID_Token setzen.
9. WHEN ein Sentenza_Refresh_Token an die Erneuerungs-Mutation von GraphQL_API übergeben wird, das von Auth_Service ausgestellt wurde, nicht abgelaufen ist, nicht widerrufen wurde und einem Benutzerkonto zugeordnet ist, dessen E-Mail-Adresse in der Konto_Freigabeliste enthalten ist, THE Auth_Service SHALL ohne erneute Google-Anmeldung ein neues Sentenza_Access_Token mit der in Kriterium 6 festgelegten Gültigkeitsdauer ausstellen und dessen Ablaufzeitpunkt zurückgeben.
10. THE GraphQL_API SHALL jede Query und jede Mutation mit Ausnahme der Anmelde- und der Erneuerungs-Mutation durch einen Guard schützen, der das mitgesendete Sentenza_Access_Token auf Signatur, Ablaufzeitpunkt und Zuordnung zu einem bestehenden Benutzerkonto prüft und das ermittelte Benutzerkonto für die Dauer der Operation bereitstellt.
11. IF eine geschützte Operation von GraphQL_API ohne Sentenza_Access_Token, mit einem syntaktisch unlesbaren Token, mit ungültiger Signatur, mit einem um mehr als 60 Sekunden überschrittenen Ablaufzeitpunkt oder mit einem keinem bestehenden Benutzerkonto zuordenbaren Token aufgerufen wird, THEN THE GraphQL_API SHALL die Operation mit dem Fehlercode `UNAUTHENTICATED` ablehnen, keine Nutzerdaten zurückgeben und keinen persistierten Datenbestand ändern.
12. THE Sentenza_Backend SHALL jede persistierte Entität, die Nutzerdaten enthält, genau einem Benutzerkonto zuordnen und bei jeder Abfrage ausschließlich Entitäten des dem Sentenza_Access_Token zugeordneten Benutzerkontos zurückgeben.
13. IF die von Google veröffentlichten JWKS beim Prüfen eines Google_ID_Token nicht innerhalb von 5 Sekunden abrufbar sind, THEN THE Auth_Service SHALL die Anmeldung mit dem Fehlercode `UPSTREAM_UNAVAILABLE` und einer Fehlermeldung ablehnen, die eine vorübergehend nicht mögliche Signaturprüfung anzeigt, kein Sentenza_Access_Token und kein Sentenza_Refresh_Token ausstellen und kein Benutzerkonto anlegen.
14. IF ein an die Erneuerungs-Mutation von GraphQL_API übergebenes Sentenza_Refresh_Token nicht von Auth_Service ausgestellt wurde, abgelaufen ist, widerrufen wurde oder keinem bestehenden Benutzerkonto zugeordnet werden kann, THEN THE Auth_Service SHALL die Erneuerung mit dem Fehlercode `UNAUTHENTICATED` ablehnen und kein neues Sentenza_Access_Token ausstellen.
15. IF eine geschützte Operation von GraphQL_API eine Entität anfordert, die einem anderen Benutzerkonto als dem des mitgesendeten Sentenza_Access_Token zugeordnet ist, THEN THE GraphQL_API SHALL die Entität als nicht vorhanden behandeln, keine Feldwerte der Entität zurückgeben und die Entität nicht ändern.

### Requirement 3: Aufnahme und Aufbewahrung roher Payloads

**User Story:** Als Entwickler möchte ich, dass jeder eingereichte Payload unverändert aufbewahrt wird, damit ich die Normalisierung bei einem Fehler oder einer Modelländerung erneut ausführen kann, ohne die Daten erneut bei Busuu abzuholen.

#### Acceptance Criteria

1. THE GraphQL_API SHALL genau eine Mutation zur Einreichung eines rohen Payloads durch Sentenza_Extension bereitstellen, die die Payload-Art als Wert aus der festgelegten Liste der unterstützten Payload-Arten und den Payload-Inhalt als Zeichenkette entgegennimmt.
2. WHEN ein Payload eingereicht wird, THE Ingestion_Service SHALL den Payload-Inhalt zeichengenau und ohne Umformatierung, ohne Neusortierung von Feldern und ohne Entfernen von Feldern im Raw_Payload_Store ablegen und die Normalisierung erst nach bestätigtem Abschluss dieser Ablage beginnen.
3. WHEN ein Payload im Raw_Payload_Store abgelegt wird, THE Ingestion_Service SHALL zusätzlich den Zeitpunkt der Einreichung in UTC, die Kennung des Benutzerkontos, die Payload-Art, die Quelle der Einreichung als Sentenza_Extension, die Größe des Payload-Inhalts in Byte und einen über den unveränderten Payload-Inhalt berechneten Inhalts-Hash ablegen.
4. WHEN die Normalisierung eines Payloads ohne Fehler und ohne verworfene Einträge abgeschlossen ist, THE Ingestion_Service SHALL den Verarbeitungszustand des zugehörigen Eintrags im Raw_Payload_Store auf `VERARBEITET` setzen und den Zeitpunkt des Abschlusses am Eintrag hinterlegen.
5. IF die Normalisierung eines Payloads fehlschlägt, THEN THE Ingestion_Service SHALL den Verarbeitungszustand des zugehörigen Eintrags auf `FEHLGESCHLAGEN` setzen und eine Fehlermeldung von höchstens 2.000 Zeichen, die die Ursache des Fehlschlags benennt, am Eintrag hinterlegen.
6. IF die Normalisierung eines Payloads fehlschlägt, THEN THE Ingestion_Service SHALL alle im Rahmen dieser Normalisierung vorgenommenen Änderungen am normalisierten Datenbestand zurücknehmen und den normalisierten Datenbestand in dem Zustand hinterlassen, den er vor Beginn dieser Normalisierung hatte.
7. WHEN derselbe Payload-Inhalt mehrfach eingereicht wird, THE Ingestion_Service SHALL für jede Einreichung einen eigenen Eintrag mit eigener Kennung und eigenem Zeitpunkt der Einreichung im Raw_Payload_Store anlegen, die zuvor angelegten Einträge unverändert lassen und die Einreichung nicht aufgrund eines bereits vorhandenen gleichen Inhalts-Hash ablehnen.
8. IF der Payload-Inhalt einer Einreichung die konfigurierte Größenbegrenzung von voreingestellt 10 Mebibyte überschreitet, THEN THE Ingestion_Service SHALL die Einreichung mit dem Fehlercode `BAD_USER_INPUT` ablehnen, keinen Eintrag im Raw_Payload_Store anlegen und den normalisierten Datenbestand unverändert lassen.
9. WHEN die Verarbeitung einer Einreichung abgeschlossen ist, THE Ingestion_Service SHALL die Kennung des angelegten Eintrags im Raw_Payload_Store und dessen Verarbeitungszustand als einen der Werte `VERARBEITET`, `TEILWEISE_VERARBEITET` oder `FEHLGESCHLAGEN` an den Client zurückgeben.
10. THE GraphQL_API SHALL eine Query bereitstellen, die ausschließlich die Einträge des Raw_Payload_Store des angemeldeten Benutzerkontos mit Kennung, Zeitpunkt der Einreichung, Payload-Art, Quelle der Einreichung, Größe in Byte, Inhalts-Hash und Verarbeitungszustand auflistet, absteigend nach Zeitpunkt der Einreichung sortiert, mit Filterung nach Payload-Art und nach Verarbeitungszustand sowie seitenweiser Ausgabe von höchstens 100 Einträgen je Seite.
11. IF die Payload-Art einer Einreichung nicht zu den unterstützten Payload-Arten gehört oder der Payload-Inhalt leer ist, THEN THE Ingestion_Service SHALL die Einreichung mit dem Fehlercode `BAD_USER_INPUT` ablehnen, keinen Eintrag im Raw_Payload_Store anlegen und in der Fehlermeldung den beanstandeten Eingabewert benennen.
12. THE Ingestion_Service SHALL abgelegte Payload-Inhalte dauerhaft aufbewahren und sie weder löschen noch kürzen noch bei einer Änderung des Verarbeitungszustands oder bei einer erneuten Normalisierung verändern.
13. THE GraphQL_API SHALL eine Query bereitstellen, die zu der Kennung eines Eintrags des angemeldeten Benutzerkontos den unveränderten Payload-Inhalt zurückgibt, dessen Inhalts-Hash dem am Eintrag abgelegten Inhalts-Hash entspricht.

### Requirement 4: Normalisierung des Busuu-Grammatikkatalogs

**User Story:** Als Nutzer möchte ich, dass der vollständige Busuu-Grammatikkatalog mit Kategorien, Themen, Niveaus und deutschen Bezeichnungen im Backend vorliegt, damit später Übungen zu konkreten Grammatikthemen erzeugt werden können.

#### Acceptance Criteria

1. WHEN ein Katalog-Payload verarbeitet wird, THE Busuu_Normalizer SHALL die Zielsprache aus dem Sprach-Code hinter dem letzten Unterstrich der Katalog-Kennung ableiten (Beispiel: `grammar_review_es` ergibt `es`), dabei Groß- und Kleinschreibung unbeachtet lassen, und alle im selben Vorgang angelegten oder aktualisierten Entitäten dieser Zielsprache zuordnen.
2. WHEN ein Katalog-Payload verarbeitet wird, THE Busuu_Normalizer SHALL für jeden Eintrag unter `grammar_categories` eine Grammatik_Kategorie anlegen oder aktualisieren, wobei die unveränderte Busuu-Kennung zusammen mit der Zielsprache den fachlichen Schlüssel bildet und ein bestehender Datensatz mit demselben fachlichen Schlüssel aktualisiert statt zusätzlich angelegt wird.
3. WHEN ein Katalog-Payload verarbeitet wird, THE Busuu_Normalizer SHALL für jeden Eintrag unter `grammar_topics` ein Grammatik_Thema anlegen oder aktualisieren, wobei die unveränderte Busuu-Kennung zusammen mit der Zielsprache den fachlichen Schlüssel bildet, und es derjenigen Grammatik_Kategorie zuordnen, deren Feld `structure` diese Themen-Kennung enthält.
4. THE Busuu_Normalizer SHALL Busuu-Kennungen mit einer Länge von 1 bis 200 Zeichen sowohl in der Form `grammar_category_es_1` als auch in UUID-basierter Form wie `grammar_category_d2e53328-9a1f-4b7c-8e55-1f0a2b3c4d5e` unverändert als fachlichen Schlüssel übernehmen, ohne sie zu kürzen, umzuschreiben oder anderweitig zu verändern.
5. WHEN ein Inhaltsfeld eines Katalog-Payloads einen Übersetzungsschlüssel mit dem Präfix `str_` enthält, THE Busuu_Normalizer SHALL den Klartext für die Sprachen `de` und `en` aus der Übersetzungskarte auflösen und beide Werte je Inhaltsfeld getrennt persistieren.
6. IF ein Übersetzungsschlüssel in der Übersetzungskarte fehlt oder der zugehörige Eintrag für eine der Sprachen `de` und `en` weder unter `value` noch unter `alternative_values` einen nicht-leeren Wert enthält, THEN THE Busuu_Normalizer SHALL für die betroffene Sprache den Übersetzungsschlüssel selbst als Klartext persistieren, das Inhaltsfeld als unaufgelöst kennzeichnen und eine Warnung protokollieren.
7. IF ein Eintrag der Übersetzungskarte für eine der Sprachen `de` oder `en` unter `value` keinen oder einen leeren Wert, unter `alternative_values` aber mindestens einen nicht-leeren Wert enthält, THEN THE Busuu_Normalizer SHALL den ersten nicht-leeren Wert aus `alternative_values` in der Reihenfolge seines Auftretens im Payload als Klartext dieser Sprache persistieren.
8. WHEN ein Grammatik_Thema normalisiert wird, THE Busuu_Normalizer SHALL den Wert des Felds `content.level` ohne Beachtung der Groß- und Kleinschreibung auf einen der CEFR_Level-Werte `a1`, `a2`, `b1`, `b2` oder `c1` abbilden und das Ergebnis persistieren.
9. IF das Feld `content.level` eines Grammatik_Thema fehlt, leer ist oder keinen der CEFR_Level-Werte `a1`, `a2`, `b1`, `b2`, `c1` enthält, THEN THE Busuu_Normalizer SHALL den Wert `UNBEKANNT` sowie den unveränderten Originalwert persistieren, die übrigen Felder des Grammatik_Thema unverändert weiterverarbeiten und eine Warnung protokollieren.
10. WHEN ein Grammatik_Thema normalisiert wird, THE Busuu_Normalizer SHALL den aufgelösten Klartext von `content.description` für die Sprachen `de` und `en` vollständig und ungekürzt persistieren, da dieser Beispielformen der Zielsprache enthält.
11. WHEN eine Grammatik_Kategorie normalisiert wird, THE Busuu_Normalizer SHALL je Themen-Kennung im Feld `structure` eine Sortierposition persistieren, die bei 1 beginnt und der Reihenfolge des Auftretens im Feld `structure` aufsteigend in Schritten von 1 folgt, wobei bei mehrfachem Auftreten derselben Themen-Kennung die erste Position gilt.
12. IF das Feld `structure` einer Grammatik_Kategorie eine Themen-Kennung enthält, zu der kein Eintrag unter `grammar_topics` vorliegt, THEN THE Busuu_Normalizer SHALL das Grammatik_Thema mit dieser Kennung, ohne Bezeichnung, ohne Beschreibung, mit dem CEFR_Level `UNBEKANNT` und mit der Sortierposition aus `structure` anlegen, es als unvollständig kennzeichnen und eine Warnung protokollieren.
13. WHEN ein Grammatik_Thema normalisiert wird, THE Busuu_Normalizer SHALL das Feld `premium` als Wahrheitswert und das Feld `access_tier` als unveränderte Zeichenkette persistieren und bei fehlendem Feld `premium` den Wert `false` sowie bei fehlendem Feld `access_tier` einen leeren Wert ablegen.
14. WHEN derselbe Katalog-Payload zweimal hintereinander verarbeitet wird, THE Busuu_Normalizer SHALL nach der zweiten Verarbeitung denselben normalisierten Datenbestand hinterlassen wie nach der ersten Verarbeitung, sodass Anzahl, fachliche Schlüssel, Bezeichnungen, Beschreibungen, CEFR_Level, Sortierpositionen und Kategoriezuordnungen der Entitäten übereinstimmen und keine zusätzliche Entität angelegt wird.
15. IF ein Katalog-Payload ein Grammatik_Thema nicht mehr enthält, das zuvor persistiert wurde, THEN THE Busuu_Normalizer SHALL das bestehende Grammatik_Thema samt Bezeichnung, Beschreibung, CEFR_Level, Sortierposition und zugehörigem Lernstand erhalten und als nicht mehr im Katalog enthalten kennzeichnen.
16. IF die Kennung eines Katalog-Payloads keinen von Sentenza unterstützten Sprach-Code für eine Zielsprache enthält, THEN THE Busuu_Normalizer SHALL die Verarbeitung mit einer Fehlermeldung abbrechen, die die nicht auflösbare Katalog-Kennung benennt, und keine Grammatik_Kategorie und kein Grammatik_Thema anlegen oder ändern.
17. IF eine Themen-Kennung unter `grammar_topics` in keinem Feld `structure` einer Grammatik_Kategorie desselben Payloads referenziert wird, THEN THE Busuu_Normalizer SHALL das Grammatik_Thema ohne Zuordnung zu einer Grammatik_Kategorie und ohne Sortierposition persistieren und eine Warnung protokollieren.
18. IF ein Katalog-Payload eine zuvor persistierte Grammatik_Kategorie nicht mehr enthält, THEN THE Busuu_Normalizer SHALL die bestehende Grammatik_Kategorie samt ihrer Zuordnungen zu Grammatik_Themen erhalten und als nicht mehr im Katalog enthalten kennzeichnen.

### Requirement 5: Normalisierung des Busuu-Lernstands

**User Story:** Als Nutzer möchte ich, dass mein Grammatik-Lernstand pro Thema im Backend vorliegt, damit Übungen später an meinem tatsächlichen Kenntnisstand ausgerichtet werden können.

#### Acceptance Criteria

1. WHEN ein Lernstands-Payload verarbeitet wird, THE Busuu_Normalizer SHALL die Einträge unter `data` in der im Payload gelieferten Reihenfolge verarbeiten und je Eintrag einen Lernstand mit der unveränderten Stärke aus `strength` und dem unveränderten Prozentwert aus `percentage` zum Grammatik_Thema mit der Kennung aus `topic_id` und zum Benutzerkonto der zugrunde liegenden Einreichung anlegen oder aktualisieren.
2. WHEN ein Lernstand zu einem Grammatik_Thema aktualisiert wird, THE Busuu_Normalizer SHALL Stärke, Prozentwert und Zeitpunkt der letzten Beobachtung des bisherigen Lernstands vollständig durch die neuen Werte ersetzen und je Kombination aus Benutzerkonto und Grammatik_Thema genau einen Lernstand-Datensatz hinterlassen.
3. WHEN ein Lernstand persistiert wird, THE Busuu_Normalizer SHALL den im Raw_Payload_Store hinterlegten Zeitpunkt der Einreichung des zugrunde liegenden Payloads als Zeitpunkt der letzten Beobachtung persistieren und nicht den Zeitpunkt der Normalisierung.
4. IF ein Lernstands-Eintrag eine Themen-Kennung enthält, zu der kein Grammatik_Thema persistiert ist, THEN THE Busuu_Normalizer SHALL ein Grammatik_Thema mit dieser Kennung und ohne Bezeichnung anlegen, es als nicht im Grammatik_Katalog enthalten kennzeichnen, den Lernstand daran binden und eine Warnung protokollieren.
5. IF ein Lernstands-Eintrag kein Feld `percentage`, einen nicht ganzzahligen Wert oder einen Prozentwert außerhalb des Bereichs 0 bis 100 enthält, THEN THE Busuu_Normalizer SHALL den Eintrag verwerfen, einen bereits persistierten Lernstand des betroffenen Grammatik_Thema unverändert lassen und die Verarbeitung der übrigen Einträge fortsetzen.
6. IF ein Lernstands-Eintrag kein Feld `strength` oder eine Stärke enthält, die keine nicht-negative ganze Zahl ist, THEN THE Busuu_Normalizer SHALL den Eintrag verwerfen, einen bereits persistierten Lernstand des betroffenen Grammatik_Thema unverändert lassen und die Verarbeitung der übrigen Einträge fortsetzen.
7. WHEN mindestens ein Lernstands-Eintrag verworfen wurde, THE Ingestion_Service SHALL den Verarbeitungszustand des Eintrags im Raw_Payload_Store auf `TEILWEISE_VERARBEITET` setzen, die Anzahl der verworfenen und die Anzahl der persistierten Einträge am Eintrag hinterlegen und die persistierten Lernstände erhalten.
8. WHEN derselbe Lernstands-Payload zweimal hintereinander verarbeitet wird, THE Busuu_Normalizer SHALL nach der zweiten Verarbeitung dieselbe Anzahl an Lernstand-Datensätzen sowie je Grammatik_Thema dieselbe Stärke, denselben Prozentwert und denselben Zeitpunkt der letzten Beobachtung hinterlassen wie nach der ersten Verarbeitung.
9. IF ein Lernstands-Payload ein Grammatik_Thema nicht enthält, zu dem ein Lernstand persistiert ist, einschließlich des Falls einer leeren Liste unter `data`, THEN THE Busuu_Normalizer SHALL Stärke, Prozentwert und Zeitpunkt der letzten Beobachtung des persistierten Lernstands unverändert lassen und den Lernstand nicht löschen.
10. IF ein Lernstands-Eintrag kein Feld `topic_id` oder eine leere Themen-Kennung enthält, THEN THE Busuu_Normalizer SHALL den Eintrag verwerfen, keinen Lernstand und kein Grammatik_Thema aus diesem Eintrag anlegen und die Verarbeitung der übrigen Einträge fortsetzen.
11. IF ein Lernstands-Payload mehrere Einträge mit derselben Themen-Kennung enthält, THEN THE Busuu_Normalizer SHALL den in der Reihenfolge unter `data` letzten gültigen Eintrag dieser Themen-Kennung als Lernstand persistieren und für diese Themen-Kennung genau einen Lernstand-Datensatz hinterlassen.
12. IF das Feld `status` eines Lernstands-Payloads einen anderen Wert als `ok` enthält, THEN THE Busuu_Normalizer SHALL die Verarbeitung mit einer Fehlermeldung abbrechen, die den abweichenden Wert benennt, und keinen Lernstand anlegen oder ändern.

### Requirement 6: Verlustfreiheit der Busuu-Normalisierung

**User Story:** Als Entwickler möchte ich nachweisen können, dass die Normalisierung der Busuu-Payloads keine fachlich relevanten Informationen verliert oder verfälscht, weil Parser für fremde Datenformate erfahrungsgemäß fehleranfällig sind.

#### Acceptance Criteria

1. WHEN ein Katalog-Payload oder ein Lernstands-Payload zur Verarbeitung übergeben wird, THE Busuu_Normalizer SHALL den vollständigen Payload gegen das für seine Payload-Art deklarierte Schema validieren, bevor er den ersten Datensatz des normalisierten Datenmodells anlegt oder ändert.
2. IF ein Payload das für seine Payload-Art deklarierte Schema verletzt, THEN THE Busuu_Normalizer SHALL die Verarbeitung dieses Payloads abbrechen, keinen Datensatz des normalisierten Datenmodells anlegen oder ändern und einen Fehler melden, der die Payload-Art und den Pfad der ersten verletzten Stelle innerhalb des Payloads benennt.
3. WHEN ein normalisierter Grammatik_Katalog an Busuu_Serializer übergeben wird, THE Busuu_Serializer SHALL daraus einen Katalog-Payload erzeugen, der das für Katalog-Payloads deklarierte Schema erfüllt und für jede enthaltene Grammatik_Kategorie und jedes enthaltene Grammatik_Thema die Busuu-Kennung, die Sortierposition, das CEFR_Level und die aufgelösten Inhaltsfelder der Sprachen `de` und `en` abbildet.
4. WHEN ein normalisierter Lernstands-Datenbestand an Busuu_Serializer übergeben wird, THE Busuu_Serializer SHALL daraus einen Lernstands-Payload erzeugen, der das für Lernstands-Payloads deklarierte Schema erfüllt und je Lernstand die Themen-Kennung, die Stärke und den Prozentwert abbildet.
5. FOR ALL schemakonformen Katalog-Payloads, einschließlich solcher mit UUID-basierten Busuu-Kennungen, fehlenden Übersetzungsschlüsseln, unbekannten CEFR_Level-Werten und Themen-Kennungen ohne zugehörigen Eintrag unter `grammar_topics`, SHALL die Abfolge aus Normalisierung, Serialisierung und erneuter Normalisierung einen normalisierten Datenbestand ergeben, der im Sinne von Kriterium 8 identisch zu dem der einmaligen Normalisierung ist.
6. FOR ALL schemakonformen Lernstands-Payloads, einschließlich solcher mit Prozentwerten an den Bereichsgrenzen 0 und 100, der Stärke 0 und Themen-Kennungen ohne persistiertes Grammatik_Thema, SHALL die Abfolge aus Normalisierung, Serialisierung und erneuter Normalisierung einen normalisierten Datenbestand ergeben, der im Sinne von Kriterium 8 identisch zu dem der einmaligen Normalisierung ist.
7. WHEN ein Payload normalisiert wird, THE Busuu_Normalizer SHALL jeden Feldpfad des Payloads, für den das normalisierte Datenmodell keine Entsprechung vorsieht, als Warnung mit Payload-Art und Feldpfad protokollieren, dabei höchstens einen Protokolleintrag je eindeutigem Feldpfad und Payload erzeugen und die Verarbeitung der übrigen Felder ohne Abbruch fortsetzen.
8. THE Sentenza_Backend SHALL zwei normalisierte Datenbestände genau dann als identisch bewerten, wenn sie in der Menge der fachlichen Schlüssel und in allen fachlichen Feldwerten der zugehörigen Datensätze übereinstimmen; technische Datenbank-Kennungen sowie Erzeugungs- und Änderungszeitstempel bleiben beim Vergleich unberücksichtigt.
9. THE Busuu_Serializer SHALL ausschließlich innerhalb der automatisierten Prüfungen von Sentenza_Backend verwendbar und über keine Query und keine Mutation der GraphQL_API erreichbar sein.
10. IF Busuu_Serializer aus einem normalisierten Datenbestand keinen schemakonformen Payload erzeugen kann, THEN THE Busuu_Serializer SHALL die Round-Trip-Prüfung als fehlgeschlagen melden, den fachlichen Schlüssel des betroffenen Datensatzes und das nicht abbildbare Feld benennen und den normalisierten Datenbestand unverändert lassen.

### Requirement 7: Abfrage von Katalog und Lernstand

**User Story:** Als Entwickler der späteren Schreib-App möchte ich Grammatikthemen samt Niveau und Lernstand über GraphQL abfragen können, damit Übungen anhand des Kenntnisstands ausgewählt werden können.

#### Acceptance Criteria

1. WHEN die Katalog-Query von GraphQL_API mit einer Zielsprache aufgerufen wird, THE GraphQL_API SHALL alle Grammatik_Kategorien dieser Zielsprache mit ihren zugeordneten Grammatik_Themen zurückgeben, die Grammatik_Kategorien nach ihrer Busuu-Kennung aufsteigend ordnen und die Grammatik_Themen innerhalb einer Grammatik_Kategorie nach Sortierposition aufsteigend und bei gleicher Sortierposition nach Busuu-Kennung aufsteigend ordnen.
2. WHEN Grammatik_Themen abgefragt werden, THE GraphQL_API SHALL je Grammatik_Thema die Busuu-Kennung, die Bezeichnung in den Sprachen `de` und `en`, die Beschreibung in den Sprachen `de` und `en`, das CEFR_Level und die Sortierposition zurückgeben.
3. WHEN Grammatik_Themen abgefragt werden, THE GraphQL_API SHALL je Grammatik_Thema den Lernstand des angemeldeten Benutzerkontos mit Stärke, Prozentwert und Zeitpunkt der letzten Beobachtung zurückgeben und keine Lernstände anderer Benutzerkonten einbeziehen.
4. IF zu einem Grammatik_Thema kein Lernstand des angemeldeten Benutzerkontos vorliegt, THEN THE GraphQL_API SHALL das Grammatik_Thema als Ungeübtes_Thema kennzeichnen, keinen Lernstand-Wert zurückgeben und das Grammatik_Thema dennoch im Ergebnis der Query enthalten.
5. THE GraphQL_API SHALL eine Filterung der Grammatik_Themen nach einer Liste von CEFR_Level-Werten aus `a1`, `a2`, `b1`, `b2`, `c1` und `UNBEKANNT` unterstützen, bei mehreren angegebenen Werten alle Grammatik_Themen zurückgeben, deren CEFR_Level einem der angegebenen Werte entspricht, und ohne Angabe dieses Filters keine Einschränkung nach CEFR_Level vornehmen.
6. THE GraphQL_API SHALL eine Filterung der Grammatik_Themen danach unterstützen, ob ein Lernstand des angemeldeten Benutzerkontos vorliegt, mit den Ausprägungen ausschließlich Grammatik_Themen mit Lernstand, ausschließlich Ungeübte_Themen und ohne Einschränkung, wobei ohne Angabe dieses Filters die Ausprägung ohne Einschränkung gilt.
7. WHEN eine Query Grammatik_Themen mehrerer Grammatik_Kategorien auflöst, THE GraphQL_API SHALL die zugehörigen Grammatik_Themen und Lernstände über DataLoader gebündelt laden und je Auflösungsebene höchstens eine Datenbankabfrage ausführen, unabhängig von der Anzahl der aufgelösten Grammatik_Kategorien.
8. THE GraphQL_API SHALL das GraphQL-Schema code-first aus Decorators erzeugen.
9. IF die Katalog-Query ohne Angabe einer Zielsprache oder mit einem Wert aufgerufen wird, der keiner von Sentenza unterstützten Zielsprache entspricht, THEN THE GraphQL_API SHALL die Query mit dem Fehlercode `BAD_USER_INPUT` ablehnen und keine Grammatik_Kategorien zurückgeben.
10. IF zu einer unterstützten Zielsprache keine Grammatik_Kategorien persistiert sind oder kein Grammatik_Thema den gesetzten Filtern entspricht, THEN THE GraphQL_API SHALL eine leere Liste und keinen Fehler zurückgeben.
11. THE GraphQL_API SHALL Grammatik_Themen, die als nicht mehr im Katalog enthalten gekennzeichnet sind, nur dann zurückgeben, wenn deren Einbeziehung über einen Filter ausdrücklich angefordert wird.

### Requirement 8: Chrome Extension zur Busuu-Datenerfassung

**User Story:** Als Nutzer möchte ich, dass mein Busuu-Lernstand automatisch erfasst wird, während ich den Grammatiktrainer benutze, damit ich keine Daten manuell übertragen muss.

#### Acceptance Criteria

1. THE Sentenza_Extension SHALL nach Manifest V3 aufgebaut sein und ihre Host-Berechtigungen ausschließlich auf die Busuu-Domänen und die konfigurierte Adresse von Sentenza_Backend beschränken, ohne eine Berechtigung für alle Adressen zu deklarieren.
2. WHEN der Nutzer in Sentenza_Extension die Anmeldung auslöst, THE Sentenza_Extension SHALL über `chrome.identity.launchWebAuthFlow` ein Google_ID_Token beschaffen und innerhalb von höchstens 120 Sekunden nach dem Auslösen an die Anmelde-Mutation von GraphQL_API übergeben.
3. WHEN Sentenza_Extension ein Sentenza_Access_Token und ein Sentenza_Refresh_Token erhält, THE Sentenza_Extension SHALL beide Token im lokalen Erweiterungsspeicher ablegen, den Anmeldestatus auf angemeldet setzen und das Google_ID_Token nicht dauerhaft speichern.
4. WHILE ein gültiges Sentenza_Refresh_Token in Sentenza_Extension vorliegt, WHEN eine Übertragung ansteht und die Restgültigkeit des Sentenza_Access_Token weniger als 60 Sekunden beträgt, THE Sentenza_Extension SHALL ohne Zutun des Nutzers ein neues Sentenza_Access_Token über die Erneuerungs-Mutation von GraphQL_API anfordern und die Übertragung anschließend mit dem neuen Sentenza_Access_Token durchführen.
5. WHEN eine Busuu-Seite geladen wird, THE Sentenza_Extension SHALL zum Zeitpunkt `document_start` und vor dem ersten Netzwerkaufruf der Seite ein Skript in den Seitenkontext einfügen, das die Browser-Schnittstellen `fetch` und `XMLHttpRequest` umhüllt und den vollständigen Antwortinhalt als Zeichenkette ausliest.
6. WHEN eine abgefangene Antwort dem konfigurierten Muster für den Busuu-Lernstands-Endpunkt (`progress`) oder dem konfigurierten Muster für den Katalog-Endpunkt (`grammar_review_es`) entspricht, THE Sentenza_Extension SHALL den Antwortinhalt zusammen mit der zugehörigen Payload-Art und dem Zeitpunkt der Erfassung an den Hintergrunddienst der Erweiterung weitergeben.
7. WHEN Sentenza_Extension einen Antwortinhalt weitergibt, THE Sentenza_Extension SHALL denselben Antwortinhalt unverändert an die aufrufende Busuu-Seite zustellen und die Zustellung dabei um höchstens 50 Millisekunden verzögern.
8. WHEN der Hintergrunddienst von Sentenza_Extension einen Antwortinhalt erhält und ein gültiges Sentenza_Access_Token vorliegt, THE Sentenza_Extension SHALL den Antwortinhalt unverändert über die Einreichungs-Mutation von GraphQL_API mit der zugehörigen Payload-Art übertragen.
9. IF Sentenza_Extension zum Zeitpunkt einer Erfassung nicht angemeldet ist, THEN THE Sentenza_Extension SHALL den Antwortinhalt mit Payload-Art und Erfassungszeitpunkt im lokalen Erweiterungsspeicher zwischenspeichern, höchstens 50 Antwortinhalte vorhalten und die zwischengespeicherten Antwortinhalte nach der nächsten erfolgreichen Anmeldung in der Reihenfolge ihrer Erfassung übertragen.
10. IF die Übertragung eines Antwortinhalts fehlschlägt, THEN THE Sentenza_Extension SHALL den Antwortinhalt im lokalen Erweiterungsspeicher belassen, die Übertragung bis zu dreimal mit Wartezeiten von 1, 4 und 16 Sekunden wiederholen und nach der dritten erfolglosen Wiederholung den Antwortinhalt zwischengespeichert belassen sowie eine Fehlermeldung mit dem Grund des Fehlschlags im Popup anzeigen.
11. WHEN ein Antwortinhalt erfolgreich übertragen wurde, THE Sentenza_Extension SHALL den zwischengespeicherten Antwortinhalt aus dem lokalen Erweiterungsspeicher entfernen und den Zeitpunkt der letzten erfolgreichen Übertragung aktualisieren.
12. WHEN der Nutzer das Popup von Sentenza_Extension öffnet, THE Sentenza_Extension SHALL innerhalb von höchstens 1 Sekunde den Anmeldestatus, den Zeitpunkt der letzten erfolgreichen Übertragung, die Anzahl der zwischengespeicherten Antwortinhalte und die letzte Fehlermeldung anzeigen und für eine noch nicht erfolgte Übertragung sowie für eine fehlende Fehlermeldung jeweils einen Platzhalter ausgeben.
13. IF ein abgefangener Antwortinhalt keinem konfigurierten Muster entspricht, THEN THE Sentenza_Extension SHALL den Antwortinhalt verwerfen, ihn nicht im lokalen Erweiterungsspeicher ablegen und keine Übertragung auslösen.
14. THE Sentenza_Extension SHALL ausschließlich Antwortinhalte übertragen, die einem konfigurierten Muster entsprechen, und keine Seiteninhalte, Eingaben des Nutzers, Cookies, Browserverlaufsdaten oder Antworten anderer Endpunkte erfassen oder übertragen.
15. IF der Nutzer die Anmeldung über `chrome.identity.launchWebAuthFlow` abbricht, die Beschaffung des Google_ID_Token nicht innerhalb von 120 Sekunden abgeschlossen ist oder die Anmelde-Mutation von GraphQL_API das Google_ID_Token ablehnt, THEN THE Sentenza_Extension SHALL kein Token im lokalen Erweiterungsspeicher ablegen, den Anmeldestatus auf nicht angemeldet setzen und im Popup eine Fehlermeldung anzeigen, die den Grund des Fehlschlags benennt.
16. IF die Erneuerung eines Sentenza_Access_Token fehlschlägt oder kein gültiges Sentenza_Refresh_Token vorliegt, THEN THE Sentenza_Extension SHALL die gespeicherten Token aus dem lokalen Erweiterungsspeicher entfernen, den Anmeldestatus auf nicht angemeldet setzen, im Popup eine erneute Anmeldung verlangen und weitere Antwortinhalte zwischenspeichern, ohne sie zu übertragen.
17. IF beim Zwischenspeichern eines Antwortinhalts die Obergrenze von 50 zwischengespeicherten Antwortinhalten bereits erreicht ist, THEN THE Sentenza_Extension SHALL den am längsten zwischengespeicherten Antwortinhalt verwerfen, den neuen Antwortinhalt ablegen und im Popup einen Hinweis auf verworfene Antwortinhalte anzeigen.

### Requirement 9: Fehlerbehandlung und Nachvollziehbarkeit

**User Story:** Als Entwickler möchte ich bei einer fehlgeschlagenen Datenaufnahme erkennen können, welcher Schritt fehlgeschlagen ist, damit ich den Fehler ohne erneutes Erzeugen der Daten beheben kann.

#### Acceptance Criteria

1. WHEN GraphQL_API eine Operation mit einem Fehler beantwortet, THE GraphQL_API SHALL je Fehler genau einen Fehlercode aus einer im Sentenza_Monorepo geteilten Enumeration mitgeben, die mindestens die Werte `UNAUTHENTICATED`, `FORBIDDEN`, `BAD_USER_INPUT`, `UPSTREAM_UNAVAILABLE` für eine vorübergehende Störung eines Fremdsystems und `INTERNAL_SERVER_ERROR` umfasst, und einen Fehler, der keinem Wert dieser Enumeration zugeordnet ist, mit dem Fehlercode `INTERNAL_SERVER_ERROR` beantworten.
2. IF eine Eingabe einer Mutation die deklarierte Validierung verletzt, THEN THE GraphQL_API SHALL die Operation mit dem Fehlercode `BAD_USER_INPUT` ablehnen, jedes verletzte Eingabefeld mit seinem Pfad innerhalb der Eingabe benennen und keinen Datensatz anlegen oder ändern.
3. IF bei der Verarbeitung ein Fehler auftritt, der keinem Wert der geteilten Fehlercode-Enumeration zugeordnet ist, THEN THE Sentenza_Backend SHALL den Fehler als strukturierten Protokolleintrag mit Zeitpunkt, Komponente, Korrelationskennung und vollständiger Ursachenkette protokollieren und dem Client eine Fehlermeldung zurückgeben, die die Korrelationskennung enthält und keinen Aufrufstapel, keine Datenbankmeldung, keinen Dateipfad und keinen Hostnamen enthält.
4. WHEN Sentenza_Backend einen Fehler eines Ingestion_Vorgangs protokolliert, THE Sentenza_Backend SHALL den fehlgeschlagenen Verarbeitungsschritt benennen und die Kennung des zugehörigen Eintrags im Raw_Payload_Store mit protokollieren, sofern ein solcher Eintrag vorliegt.
5. THE Sentenza_Backend SHALL Zugangsdaten, Google_ID_Token, Sentenza_Access_Token, Sentenza_Refresh_Token und Payload-Inhalte von der Protokollierung ausnehmen und anstelle des Payload-Inhalts ausschließlich dessen Inhalts-Hash und Größe protokollieren.
6. IF eine Datenbankoperation eines Ingestion_Vorgangs fehlschlägt, THEN THE Sentenza_Backend SHALL alle zu diesem Ingestion_Vorgang gehörenden Schreibvorgänge des normalisierten Datenbestands in einer einzigen Transaktion zurückrollen und den Eintrag dieses Ingestion_Vorgangs im Raw_Payload_Store samt Verarbeitungszustand erhalten.
7. THE Sentenza_Backend SHALL einen lokal erreichbaren Endpunkt zur Prüfung der Betriebsbereitschaft bereitstellen, der die Erreichbarkeit der Datenbank einschließt.
8. WHEN der Endpunkt zur Prüfung der Betriebsbereitschaft aufgerufen wird, THE Sentenza_Backend SHALL innerhalb von 5 Sekunden eine Antwort zurückgeben, die den Gesamtzustand sowie das Ergebnis der Datenbankprüfung je geprüfter Abhängigkeit benennt.
9. IF die Datenbank bei einer Prüfung der Betriebsbereitschaft innerhalb von 5 Sekunden nicht erreichbar ist, THEN THE Sentenza_Backend SHALL den Gesamtzustand als nicht betriebsbereit melden und die nicht erreichbare Abhängigkeit benennen.
10. WHEN ein Ingestion_Vorgang beginnt, THE Sentenza_Backend SHALL eine für diesen Ingestion_Vorgang eindeutige Korrelationskennung erzeugen und sie allen Protokolleinträgen dieses Ingestion_Vorgangs mitgeben.

### Requirement 10: Testabdeckung

**User Story:** Als Entwickler möchte ich mich auf eine automatisierte Prüfung der Aufnahme-Kette verlassen können, damit Änderungen am Datenmodell nicht unbemerkt Daten verfälschen.

#### Acceptance Criteria

1. THE Sentenza_Monorepo SHALL Vitest als Testwerkzeug für Sentenza_Backend, Sentenza_Extension und jedes geteilte Workspace-Paket verwenden und alle Testläufe über die Turborepo-Aufgabe `test` in einem einmaligen Durchlauf ohne Beobachtungsmodus ausführen.
2. THE Sentenza_Monorepo SHALL Tests in einem Ordner `__tests__` unmittelbar neben dem geprüften Quelltext ablegen und Testdateien nach dem Muster `<name>.test.ts` benennen, wobei `<name>` dem Namen der geprüften Quelldatei ohne Dateierweiterung entspricht.
3. THE Sentenza_Monorepo SHALL je exportierter Funktion von Busuu_Normalizer und Auth_Service mindestens einen Test des erwarteten Ablaufs sowie mindestens einen Test enthalten, der eine in diesem Dokument für diese Funktion beschriebene Fehler- oder Verwerfungsbedingung auslöst und das dort festgelegte beobachtbare Verhalten prüft.
4. THE Sentenza_Monorepo SHALL jede der beiden in Requirement 6 festgelegten Round-Trip-Eigenschaften, je eine für Katalog-Payloads und für Lernstands-Payloads, als eigenschaftsbasierten Test mit mindestens 100 je Durchlauf erzeugten, schemakonformen Eingaben prüfen, wobei die erzeugten Eingaben beide Formen der Busuu-Kennungen, alle bekannten CEFR_Level-Werte, fehlende Übersetzungsschlüssel und leere Sammlungen abdecken.
5. IF ein eigenschaftsbasierter Test eine Round-Trip-Eigenschaft widerlegt, THEN THE Sentenza_Monorepo SHALL den Test als fehlgeschlagen melden und das minimierte Gegenbeispiel samt dem verwendeten Startwert der Eingabeerzeugung ausgeben.
6. THE Sentenza_Monorepo SHALL je Idempotenz-Anforderung aus Requirement 4 und Requirement 5 mindestens einen Test gegen eine Testdatenbank enthalten, der denselben Payload zweimal hintereinander verarbeitet und nach dem zweiten Durchlauf die Gleichheit aller persistierten Feldwerte sowie die unveränderte Anzahl der Datensätze gegenüber dem ersten Durchlauf prüft.
7. WHEN ein Test gegen die Testdatenbank ausgeführt wird, THE Sentenza_Monorepo SHALL die Testdatenbank vor dem Test auf einen leeren, vollständig migrierten Ausgangszustand zurücksetzen und ausschließlich die als Testdatenbank konfigurierte Instanz verwenden.
8. THE Sentenza_Monorepo SHALL genau zwei unveränderte Busuu-Beispielpayloads als Fixture-Dateien im Repository vorhalten, davon einen Katalog-Payload und einen Lernstands-Payload, und beide in den Tests von Busuu_Normalizer verwenden.
9. THE Sentenza_Monorepo SHALL die Anmeldekette von Sentenza_Extension und die Prüfung eines Google_ID_Token durch Auth_Service in Tests durch Attrappen ersetzen, sodass während der Aufgabe `test` keine Verbindung zu Google und keine Verbindung zu Busuu aufgebaut wird.
10. IF eine exportierte Funktion von Busuu_Normalizer oder Auth_Service keine in diesem Dokument beschriebene Fehler- oder Verwerfungsbedingung besitzt, THEN THE Sentenza_Monorepo SHALL für diese Funktion mindestens einen Test einer Grenzbedingung mit leerer Eingabe oder fehlendem optionalem Feld enthalten.
11. IF mindestens ein Test der Aufgabe `test` fehlschlägt, THEN THE Sentenza_Monorepo SHALL die Aufgabe mit einem von Null verschiedenen Exit-Code beenden und je fehlgeschlagenem Test die Testdatei, den Testnamen und die Abweichung zwischen erwartetem und beobachtetem Wert ausgeben.
