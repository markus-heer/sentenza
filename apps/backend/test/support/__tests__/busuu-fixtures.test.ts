import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BUSUU_FIXTURE_FILES,
  type BusuuFixtureKind,
  busuuFixtureRepositoryPath,
  readBusuuFixtureBytes,
} from '../busuu-fixtures.js';

/**
 * Integritätstest der Busuu-Fixtures (Aufgabe 17.3; Requirement 10.8;
 * design.md, Abschnitt "Fixtures" und "Schutz der Fixtures vor Formatierung").
 *
 * Geprüft werden Byte-Größe und SHA-256 der beiden Dateien
 * `fixtures/busuu/grammar-review-es.json` und `fixtures/busuu/progress.json`
 * gegen die unten hinterlegten Werte. Zweck: Ein Formatierungswerkzeug, das die
 * Dateien anfasst, macht die Aufgabe `test` rot, statt die Änderung unbemerkt
 * mitzunehmen. Das ist bereits zweimal passiert — `fixtures/` steht deshalb seit
 * Aufgabe 1.3 in `.prettierignore` und in den ESLint-Ignores, und dieser Test
 * ist die zweite Schranke dahinter.
 *
 * **Vorbehalt zum Aussagegehalt** (tasks.md, `## Notes`, "Vorbehalt zu den
 * Fixtures"). Die hinterlegten Werte sind **nicht** die des echten
 * Busuu-Byteformats. Ein Format-on-Save des Editors hat beide Dateien vor der
 * Umsetzung dieser Aufgabe umformatiert: Der JSON-Inhalt ist unverändert
 * geblieben, Größe und Inhalts-Hash sind es nicht. Die Byte-Kodierung des
 * Originals ist nicht rekonstruierbar — Busuu liefert Nicht-ASCII-Zeichen und
 * Schrägstriche escaped aus, eine Wiederverdichtung über `JSON.stringify` trifft
 * den ursprünglichen Stand nicht. Die Werte sind daher aus dem zum Zeitpunkt der
 * Umsetzung vorliegenden Dateizustand abgeleitet.
 *
 * Damit gilt: Der Test schützt vor **künftiger** unbemerkter Umformatierung. Er
 * belegt **nicht**, dass die Fixtures byte-identisch zu den Antworten von Busuu
 * sind. Requirement 10.8 ist insoweit erst teilweise erfüllt.
 *
 * **Nachzuziehen, sobald frische Payloads vorliegen:** beide Antworten erneut
 * aus dem Browser abgreifen, unangetastet unter `fixtures/busuu/` ablegen und
 * die Konstanten in `EXPECTED_FIXTURE_BYTES` neu setzen. Erst dann prüft dieser
 * Test das echte Busuu-Byteformat.
 *
 * Ohne Datenbank, ohne Netzzugriff: gelesen werden zwei Dateien von der Platte.
 */

/**
 * Erwartete Byte-Größe und erwarteter SHA-256 je Fixture, abgeleitet aus dem
 * bei Umsetzung von Aufgabe 17.3 vorliegenden Dateizustand (Stand
 * 2026-09-25). Siehe den Vorbehalt im Kopfkommentar, bevor diese Werte
 * geändert werden: Ein Fehlschlag ist zunächst ein Verdacht auf eine
 * unbeabsichtigte Umformatierung, nicht ein Grund, die Werte nachzuziehen.
 */
const EXPECTED_FIXTURE_BYTES: Readonly<
  Record<BusuuFixtureKind, { readonly byteLength: number; readonly sha256: string }>
> = {
  catalog: {
    byteLength: 129817,
    sha256: 'dd3abc6b1d1043a79997d14f63a32c0c02ac60d3354cc1ea197d538b56a48aee',
  },
  progress: {
    byteLength: 913,
    sha256: '180f95e6b195b53005691f641040b0f0ae23c2590a4c22f25d7549ddc38fb4c2',
  },
};

const FIXTURE_KINDS = Object.keys(EXPECTED_FIXTURE_BYTES) as readonly BusuuFixtureKind[];

describe('Integrität der Busuu-Fixtures', () => {
  it('hält genau zwei Fixture-Dateien vor: einen Katalog- und einen Lernstands-Payload', () => {
    // Requirement 10.8 nennt die Zahl zwei ausdrücklich. Kommt eine dritte
    // Datei hinzu oder verschwindet eine, soll das hier auffallen und nicht
    // erst in den Tests des Normalizers.
    expect(Object.keys(BUSUU_FIXTURE_FILES).sort()).toEqual(['catalog', 'progress']);
  });

  for (const kind of FIXTURE_KINDS) {
    const expected = EXPECTED_FIXTURE_BYTES[kind];
    const repositoryPath = busuuFixtureRepositoryPath(kind);

    // Größe und Hash stehen absichtlich in zwei getrennten Prüfungen: Der Name
    // des fehlgeschlagenen Tests benennt dann bereits Datei und Hinsicht, ohne
    // dass die Meldung gelesen werden muss.
    describe(repositoryPath, () => {
      it(`hat unverändert ${String(expected.byteLength)} Bytes`, () => {
        const bytes = readBusuuFixtureBytes(kind);

        expect(
          bytes.byteLength,
          `${repositoryPath}: Byte-Größe abweichend — erwartet ${String(expected.byteLength)}, ` +
            `gelesen ${String(bytes.byteLength)}. Die Datei wurde verändert, ` +
            `vermutlich von einem Formatierungswerkzeug. Siehe den Kopfkommentar dieser Testdatei.`,
        ).toBe(expected.byteLength);
      });

      it('hat unveränderten SHA-256', () => {
        const bytes = readBusuuFixtureBytes(kind);
        const sha256 = createHash('sha256').update(bytes).digest('hex');

        expect(
          sha256,
          `${repositoryPath}: SHA-256 abweichend — erwartet ${expected.sha256}, ` +
            `berechnet ${sha256}. Der Inhalt der Datei wurde verändert. ` +
            `Siehe den Kopfkommentar dieser Testdatei.`,
        ).toBe(expected.sha256);
      });
    });
  }
});
