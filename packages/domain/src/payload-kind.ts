/**
 * Payload-Art: die Kennzeichnung der Struktur eines eingereichten Payloads.
 *
 * Einzige Deklarationsstelle dieser Enumeration im Sentenza_Monorepo
 * (Requirement 1.4). Backend (Prisma-Enum, GraphQL via `registerEnumType`)
 * und Sentenza_Extension importieren diesen Typ, statt ihn erneut zu
 * deklarieren.
 */
export enum PayloadKind {
  /** Katalog-Payload: liefert den Grammatik_Katalog einer Zielsprache. */
  CATALOG = 'CATALOG',
  /** Lernstands-Payload: liefert den Lernstand je Grammatik_Thema. */
  PROGRESS = 'PROGRESS',
}
