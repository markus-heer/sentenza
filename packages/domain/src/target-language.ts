/**
 * Zielsprache: die von Sentenza unterstützte Lernsprache, abgeleitet aus der
 * Katalog-Kennung (Beispiel: `grammar_review_es` ergibt Spanisch).
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 1.4). `TargetLanguage` ist eine geschlossene Enumeration mit
 * derzeit genau einem Wert, `ES` (siehe design.md).
 */
export enum TargetLanguage {
  ES = 'ES',
}
