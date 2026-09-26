/**
 * Das angemeldete Benutzerkonto und der Weg, auf dem es durch eine Operation
 * getragen wird (Requirement 2.10, 2.12; design.md, Abschnitt "Guard und
 * Request-Kontext").
 *
 * Reine Typdatei ohne Laufzeitanteil, und das mit Absicht: `JwtStrategy`
 * ermittelt das Konto, `GqlAuthGuard` legt es in den GraphQL-Kontext und
 * `@CurrentUser()` liest es dort. Alle drei brauchen dieselbe Form. Stünde sie
 * in einer der drei Dateien, müssten die beiden anderen sie von dort
 * importieren und damit Passport beziehungsweise den Guard mitziehen, nur um
 * einen Typ zu kennen.
 */

/**
 * Das Benutzerkonto, das ein geprüftes Sentenza_Access_Token bezeichnet.
 *
 * Bewusst auf `id` und `email` beschränkt: Mehr braucht eine geschützte
 * Operation nicht. `id` ist die interne Konto-Kennung und damit der Wert, mit
 * dem jede Abfrage auf die Entitäten genau dieses Kontos eingeschränkt wird
 * (Requirement 2.12); `email` steht für Protokolleinträge und eine etwaige
 * erneute Freigabeprüfung bereit. Die Google-Subject-Kennung gehört
 * ausdrücklich nicht dazu — sie ist ein Schlüssel der Anmeldung, kein
 * Betriebsmittel der laufenden Operation.
 *
 * Der Typ ist zugleich schmaler als der von Prisma gelieferte Datensatz, was
 * gewollt ist: Ein weiterer Datensatz erfüllt diese Form, aber keine
 * Aufrufstelle kann sich auf Felder verlassen, die hier nicht stehen.
 */
export interface AuthenticatedAccount {
  id: string;
  email: string;
}

/**
 * Der Zugriff auf das Benutzerkonto anhand seiner internen Kennung
 * (Requirement 2.10: "Zuordnung zu einem bestehenden Benutzerkonto").
 *
 * So schmal geschnitten wie `AuthStore` in `auth.service.ts` und
 * `DatabasePingClient` in `health/probe-database.ts`: Ein einziger Lesezugriff,
 * damit die Prüfung des Access-Tokens ohne laufende Nest-Anwendung und ohne
 * Datenbank prüfbar bleibt. `PrismaService` erfüllt diese Form; dass er es
 * tut, bestätigt der Type-Check an der Erzeugungsstelle in `auth.module.ts`.
 */
export interface AuthenticatedAccountStore {
  findUnique(args: { where: { id: string } }): Promise<AuthenticatedAccount | null>;
}

/** Die Teilmenge von Prisma, die die Prüfung des Access-Tokens braucht. */
export interface AccessTokenStore {
  userAccount: AuthenticatedAccountStore;
}

/**
 * Der GraphQL-Kontext, soweit `GqlAuthGuard` und `@CurrentUser()` ihn
 * auswerten (design.md, Abschnitt "Guard und Request-Kontext").
 *
 * `req` ist die HTTP-Anfrage, die der Apollo-Treiber immer in den Kontext
 * legt; Passport hinterlegt das geprüfte Konto dort unter `user`. `user`
 * unmittelbar am Kontext ist die Stelle, an der der Guard es für die Dauer der
 * Operation bereitstellt und an der `@CurrentUser()` es liest — ein
 * Feldresolver kennt den Kontext, aber nicht notwendigerweise die HTTP-Anfrage.
 *
 * Beide Felder sind optional, weil der Typ eine Fremdstruktur beschreibt: Wer
 * ihn liest, muss mit einem Kontext ohne Konto umgehen können, statt sich auf
 * einen bereits gelaufenen Guard zu verlassen.
 */
export interface AuthenticatedGraphQLContext {
  req?: { user?: AuthenticatedAccount };
  user?: AuthenticatedAccount;
}
