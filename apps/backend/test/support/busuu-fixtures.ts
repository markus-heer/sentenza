import { readFileSync } from 'node:fs';

/**
 * Zugriff auf die beiden unveränderten Busuu-Beispielpayloads unter
 * `fixtures/busuu/` (Requirement 10.8; design.md, Abschnitt "Fixtures").
 *
 * Die Dateien liegen in der Wurzel des Monorepos, nicht im Backend-Paket: Sie
 * sind Rohdaten der Fremdquelle und keiner Anwendung zugeordnet. Verbraucht
 * werden sie von den Tests des Busuu_Normalizer, die im Backend liegen —
 * deshalb steht der Zugriff hier unter `test/support/`, neben den übrigen
 * Prüfmitteln. `tsconfig.json` des Backends schließt `test` aus dem Build aus,
 * und eine ESLint-Regel verbietet Importe aus `test/support/**` in `src/**`;
 * die Fixtures können also nicht versehentlich in den Produktionscode geraten.
 *
 * Gelesen wird bewusst **ohne Kodierungsangabe**. `readFileSync` liefert dann
 * einen `Buffer`, also die Bytes der Datei, wie sie auf der Platte stehen.
 * Genau darauf ist der Integritätstest angewiesen: Eine Interpretation als
 * Text würde eine Byte-Order-Mark oder eine abweichende Kodierung verschlucken
 * und damit die Abweichung verstecken, die er aufdecken soll.
 */

/**
 * Verzeichnis der Fixtures, aufgelöst relativ zu dieser Datei statt zum
 * Arbeitsverzeichnis des Testlaufs: `apps/backend/test/support/` → vier Ebenen
 * hinauf in die Wurzel des Monorepos. Damit findet der Zugriff die Dateien
 * unabhängig davon, aus welchem Verzeichnis Vitest gestartet wurde.
 */
const FIXTURE_DIRECTORY = new URL('../../../../fixtures/busuu/', import.meta.url);

/**
 * Die genau zwei Fixture-Dateien nach Requirement 10.8, je Art benannt: ein
 * Katalog-Payload und ein Lernstands-Payload.
 */
export const BUSUU_FIXTURE_FILES = {
  catalog: 'grammar-review-es.json',
  progress: 'progress.json',
} as const;

/** Art des Fixtures: Katalog- oder Lernstands-Payload. */
export type BusuuFixtureKind = keyof typeof BUSUU_FIXTURE_FILES;

/** Pfad des Fixtures relativ zur Wurzel des Monorepos, für Fehlermeldungen. */
export function busuuFixtureRepositoryPath(kind: BusuuFixtureKind): string {
  return `fixtures/busuu/${BUSUU_FIXTURE_FILES[kind]}`;
}

/** Die Bytes des Fixtures, uninterpretiert. */
export function readBusuuFixtureBytes(kind: BusuuFixtureKind): Buffer {
  return readFileSync(new URL(BUSUU_FIXTURE_FILES[kind], FIXTURE_DIRECTORY));
}
