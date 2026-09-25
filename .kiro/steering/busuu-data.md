---
inclusion: fileMatch
fileMatchPattern: '**/*busuu*'
---

# Busuu-Datenquelle

## Herkunft der Daten

Der Nutzer öffnet bei Busuu den Grammatiktrainer. Die Antworten der Busuu-API enthalten den Lernstand. Eine Chrome Extension (Manifest V3) fängt sie im Browser ab und überträgt sie ans Backend.

Es gibt keine offizielle Busuu-API und keine Zugangsdaten — die Daten fallen als Nebenprodukt der normalen Nutzung an. Das Format kann sich jederzeit ändern, ohne Ankündigung. Daraus folgt:

- rohe Payloads unverändert aufbewahren,
- Schema-Validierung vor der Normalisierung,
- unbekannte Feldpfade protokollieren statt stillschweigend verwerfen.

## Technischer Hinweis zum Abfangen

`chrome.webRequest` kann in Manifest V3 keine Response-Bodies lesen. Der praktikable Weg ist ein Content-Script bei `document_start`, das ein Skript in den Seitenkontext injiziert und dort `fetch` sowie `XMLHttpRequest` umhüllt.

`chrome.debugger` wäre die Alternative, zeigt aber eine dauerhafte Debug-Leiste und ist daher unbrauchbar.

Die Anmeldung der Extension läuft über `chrome.identity.launchWebAuthFlow`.

## Zwei relevante Endpunkte

### 1. Lernstand ("progress")

Liefert je Grammatikthema Stärke und Prozentwert. Struktur:

```json
{
  "status": "ok",
  "data": [
    {
      "topic_id": "grammar_topic_3d4fa7b0-ff12-44f1-9d9b-b320e67753de",
      "strength": 3,
      "percentage": 76
    },
    { "topic_id": "grammar_topic_es_1_3", "strength": 3, "percentage": 90 },
    {
      "topic_id": "grammar_topic_c9e7a9cb-c129-4cd3-9f0a-21ab86a4d8cc",
      "strength": 2,
      "percentage": 67
    }
  ]
}
```

Felder: `topic_id` (String-Kennung eines Grammatikthemas), `strength` (ganze Zahl, beobachtet 2 und 3), `percentage` (ganze Zahl 0 bis 100). Das Feld `status` hatte in allen Beobachtungen den Wert `ok`.

Wichtig: Der Endpunkt liefert nur Themen, zu denen Fortschritt vorliegt. Themen ohne Eintrag gelten als noch nicht geübt.

### 2. Katalog ("grammar_review_es")

Liefert den vollständigen Themenbestand einer Zielsprache: Kategorien, darin Themen, plus eine Übersetzungstabelle für alle Label-Strings. Gekürzte Struktur:

```json
{
  "id": "grammar_review_es",
  "class": "grammar_review",
  "type": null,
  "premium": false,
  "content": {},
  "grammar_categories": [
    {
      "id": "grammar_category_es_1",
      "class": "grammar_category",
      "premium": false,
      "content": {
        "name": "str_20190913_131",
        "description": "str_20190611_d04_1",
        "icon_pdf": "https://cdn.busuu.com/files/icons/grammar/ic_pronouns.pdf",
        "icon_dark_pdf": null,
        "icon_svg": "https://cdn.busuu.com/files/icons/grammar/ic_pronouns.svg",
        "icon_dark_svg": null
      },
      "structure": [
        "grammar_topic_2d387661-9d92-435d-9fa6-d152cda5b210",
        "grammar_topic_es_1_3",
        "grammar_topic_es_2_2"
      ],
      "grammar_topics": [
        {
          "id": "grammar_topic_es_1_3",
          "class": "grammar_topic",
          "premium": true,
          "content": {
            "name": "str__9ca5d4d12d5bdc95b6883f1f5950a45e",
            "description": "str_20190614_d04_382",
            "level": "a1"
          },
          "access_tier": "standard"
        }
      ]
    }
  ],
  "translation_map": {
    "str_20190913_131": { "de": { "value": "Pronomen" }, "en": { "value": "Pronouns" } },
    "str__9ca5d4d12d5bdc95b6883f1f5950a45e": {
      "de": { "value": "Possessivpronomen" },
      "en": { "value": "Possessive pronouns" }
    },
    "str_20190614_d04_382": {
      "de": { "value": "el mío, la tuya, el nuestro..." },
      "en": { "value": "el mío, la tuya, el nuestro..." }
    }
  },
  "entity_map": {}
}
```

## Eigenheiten, die bei der Verarbeitung zählen

- `content.name` und `content.description` sind keine Klartexte, sondern Übersetzungsschlüssel mit dem Präfix `str_`. Aufgelöst werden sie über `translation_map` für die Sprachen `de` und `en`. Manche Einträge haben zusätzlich ein Feld `alternative_values`; einzelne Einträge haben unter `value` einen leeren Wert.
- `content.level` ist das CEFR-Niveau eines Themas. Beobachtete Werte: `a1`, `a2`, `b1`, `b2`, `c1`. Dieses Feld ist zentral für die Schwierigkeitssteuerung der späteren Schreibübungen.
- `content.description` eines Themas enthält oft konkrete spanische Beispielformen, etwa "yo tengo, tú tienes, ella tiene...". Diese Beispiele sind wertvoller Prompt-Kontext für die Korrektur durch Claude Opus und dürfen nicht gekürzt werden.
- `structure` listet die Themenkennungen einer Kategorie in der Anzeigereihenfolge; `grammar_topics` enthält die zugehörigen Objekte. Beides kann auseinanderlaufen: `structure` kann Kennungen enthalten, zu denen kein Objekt vorliegt, und umgekehrt.
- Kennungen treten in zwei Formen auf: sprechend wie `grammar_category_es_1` oder `grammar_topic_es_1_3`, und UUID-basiert wie `grammar_category_d2e53328-edb1-4211-a251-5b56490ed08e` oder `grammar_topic_3d4fa7b0-ff12-44f1-9d9b-b320e67753de`. Beide unverändert als fachlichen Schlüssel übernehmen.
- Der Katalog ist sprachspezifisch: die Kennung `grammar_review_es` steht für Spanisch. Auch wenn nur Spanisch gebraucht wird, sollte das Datenmodell weitere Zielsprachen nicht verbauen.
- Die Payloads sind Momentaufnahmen. Die Aufnahme muss idempotent sein: dieselbe Antwort zweimal verarbeitet ergibt denselben Datenbestand.
- Ein Katalog kann Themen oder Kategorien verlieren, die zuvor vorhanden waren. Solche Datensätze werden nicht gelöscht, sondern als nicht mehr im Katalog enthalten gekennzeichnet.

## Fixtures

Zwei unveränderte Beispielantworten liegen als Testdaten im Repository unter `fixtures/busuu/`: eine Lernstandsantwort und eine Katalogantwort. Sie sind die Grundlage der Normalisierungstests und dürfen nicht umformatiert werden.
