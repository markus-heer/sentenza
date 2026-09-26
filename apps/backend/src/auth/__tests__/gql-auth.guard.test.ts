import 'reflect-metadata';

import { readFileSync } from 'node:fs';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RESOLVER_NAME_METADATA, RESOLVER_TYPE_METADATA } from '@nestjs/graphql';
import { SentenzaError, SentenzaErrorCode } from '@sentenza/domain';
import * as fc from 'fast-check';
import { buildSchema } from 'graphql';
import {
  type Algorithm,
  JsonWebTokenError,
  sign as signJwt,
  TokenExpiredError,
} from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { resetDatabase } from '../../../test/reset-database.js';
import { createTestDatabaseClient } from '../../../test/test-database-client.js';
import { AppResolver } from '../../app.resolver.js';
import { createLogger, type LogFields } from '../../common/logger.js';
import type { PrismaClient } from '../../prisma/prisma.types.js';
import { AuthResolver } from '../auth.resolver.js';
import type {
  AuthenticatedAccount,
  AuthenticatedGraphQLContext,
} from '../authenticated-account.js';
import { GqlAuthGuard } from '../gql-auth.guard.js';
import { ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS, JwtStrategy } from '../jwt.strategy.js';
import { Public } from '../public.decorator.js';
import {
  ACCESS_TOKEN_ALGORITHM,
  ACCESS_TOKEN_ISSUER,
  TokenIssuer,
  type TokenIssuerSettings,
} from '../token-issuer.js';

/**
 * Tests für `GqlAuthGuard` (Requirement 2.10, 2.11, 2.12).
 *
 * Kein Nest-Container und kein Passport in Gang: Geprüft wird, was der Guard
 * selbst entscheidet — die Ausnahme über `@Public()`, die Herkunft der Anfrage
 * aus dem GraphQL-Kontext und die Abbildung eines Prüfergebnisses auf
 * `UNAUTHENTICATED`. Der `Reflector` ist echt, damit die Metadaten desselben
 * Dekorators gelesen werden, den die Resolver tragen; `ExecutionContext` und
 * GraphQL-Kontext sind Doubles.
 *
 * Dass ein tatsächlich mitgesendetes Token über Passport bis in `validate`
 * gelangt, prüft der eigenschaftsbasierte Test zu Property 29 am Ende dieser
 * Datei — dort über die Felder des erzeugten Schemas und gegen die echte
 * Testdatenbank.
 */

const ACCOUNT: AuthenticatedAccount = { id: 'konto-1', email: 'lernende@example.com' };
const JWT_SECRET = 'geheim-fuer-den-test';

/** Resolver-Doppelgänger: ein ausgenommenes und ein geschütztes Feld. */
class ResolverDouble {
  @Public()
  signInWithGoogle(): void {
    // Anmeldung: kann kein Access-Token mitsenden, weil sie es erst ausstellt.
  }

  submitPayload(): void {
    // Geschützte Operation ohne Dekorator.
  }
}

/** Klasse, die als Ganzes ausgenommen ist, wie der Health-Controller. */
@Public()
class PublicClassDouble {
  check(): void {
    // Betriebsbereitschaft, ohne Anmeldung erreichbar.
  }
}

/**
 * `ExecutionContext` in der Form, die `GqlExecutionContext.create` erwartet:
 * vier Argumente eines Feldresolvers, wobei der Kontext an Position 2 steht.
 */
function contextFor(options: {
  graphqlContext?: unknown;
  handler?: () => void;
  target?: new () => unknown;
}): ExecutionContext {
  const { graphqlContext = {}, handler = () => undefined, target = ResolverDouble } = options;

  return {
    getType: () => 'graphql',
    getArgs: () => [undefined, {}, graphqlContext, undefined],
    getClass: () => target,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

/** Guard über einem echten `Reflector`, der seine Einträge sammelt statt sie auszugeben. */
function guardWithLog(): { guard: GqlAuthGuard; entries: LogFields[] } {
  const entries: LogFields[] = [];
  const logger = createLogger({
    component: 'auth',
    sink: (line) => entries.push(JSON.parse(line) as LogFields),
  });

  return { guard: new GqlAuthGuard(new Reflector(), logger), entries };
}

function guard(): GqlAuthGuard {
  return guardWithLog().guard;
}

/** Nimmt einen erwarteten `SentenzaError` ab und gibt ihn zur weiteren Prüfung zurück. */
function rejectionOf(operation: () => unknown): SentenzaError {
  try {
    operation();
  } catch (error) {
    if (error instanceof SentenzaError) {
      return error;
    }

    expect.fail(`Erwartet war ein SentenzaError, beobachtet wurde: ${String(error)}`);
  }

  return expect.fail('Erwartet war eine Ablehnung, der Aufruf ging jedoch durch.');
}

describe('Ausnahme über @Public()', () => {
  it('lässt ein Feld mit @Public() ohne Token durch', async () => {
    const context = contextFor({ handler: ResolverDouble.prototype.signInWithGoogle });

    // Requirement 2.10 nimmt Anmeldung und Erneuerung aus; ohne diesen Zweig
    // wäre keine Anmeldung möglich.
    expect(await guard().canActivate(context)).toBe(true);
  });

  it('lässt jedes Feld einer mit @Public() versehenen Klasse durch', async () => {
    const context = contextFor({
      handler: PublicClassDouble.prototype.check,
      target: PublicClassDouble,
    });

    // Der Health-Endpunkt trägt den Dekorator an der Klasse und muss auch bei
    // global registriertem Guard ohne Anmeldung antworten.
    expect(await guard().canActivate(context)).toBe(true);
  });

  it('fasst bei einem ausgenommenen Feld den GraphQL-Kontext nicht an', async () => {
    // Ein `ExecutionContext`, dessen Argumente gar nicht lesbar sind: Würde der
    // Guard vor der Ausnahme auf den GraphQL-Kontext zugreifen, schlüge das
    // hier fehl. Genau darauf beruht, dass der globale Guard den
    // HTTP-Health-Endpunkt nicht als GraphQL-Anfrage zu lesen versucht.
    const context = {
      getType: () => 'http',
      getArgs: () => {
        throw new Error('Der GraphQL-Kontext wurde entgegen der Zusage gelesen.');
      },
      getClass: () => PublicClassDouble,
      getHandler: () => PublicClassDouble.prototype.check,
    } as unknown as ExecutionContext;

    expect(await guard().canActivate(context)).toBe(true);
  });

  it('schützt ein Feld ohne @Public()', async () => {
    // `canActivate` läuft ohne Token in die Prüfung und lehnt ab; ohne
    // Passport-Strategie im Spiel bleibt entscheidend, dass nicht durchgelassen
    // wird.
    const context = contextFor({ handler: ResolverDouble.prototype.submitPayload });

    await expect(guard().canActivate(context)).rejects.toBeInstanceOf(Error);
  });
});

describe('Anfrage aus dem GraphQL-Kontext', () => {
  it('liefert die Anfrage, aus der der Header gelesen wird', () => {
    const request = { headers: { authorization: 'Bearer abc.def.ghi' } };

    // design.md: "liest den Header aus `GqlExecutionContext`".
    expect(guard().getRequest(contextFor({ graphqlContext: { req: request } }))).toBe(request);
  });

  it('lehnt ab, wenn der Kontext keine Anfrage trägt', () => {
    const rejection = rejectionOf(() => guard().getRequest(contextFor({ graphqlContext: {} })));

    // Fail-closed: eine nicht prüfbare Anfrage gilt nicht als angemeldet.
    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
  });
});

describe('Abbildung des Prüfergebnisses', () => {
  it('gibt das geprüfte Konto zurück', () => {
    expect(guard().handleRequest(null, ACCOUNT, undefined)).toEqual(ACCOUNT);
  });

  it('lehnt eine Anfrage ohne Token mit UNAUTHENTICATED ab', () => {
    const { guard: instance, entries } = guardWithLog();
    const rejection = rejectionOf(() =>
      instance.handleRequest(null, false, new Error('No auth token')),
    );

    // Requirement 2.11: fehlendes Token ⇒ `UNAUTHENTICATED`.
    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(entries.at(-1)).toMatchObject({ step: 'auth.guard', reason: 'missing-token' });
  });

  it('lehnt ein unlesbares oder falsch signiertes Token ab', () => {
    const { guard: instance, entries } = guardWithLog();
    const rejection = rejectionOf(() =>
      instance.handleRequest(null, false, new JsonWebTokenError('invalid signature')),
    );

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(entries.at(-1)).toMatchObject({ reason: 'invalid-token' });
  });

  it('lehnt ein abgelaufenes Token ab', () => {
    const { guard: instance, entries } = guardWithLog();
    const rejection = rejectionOf(() =>
      instance.handleRequest(null, false, new TokenExpiredError('jwt expired', new Date(0))),
    );

    expect(rejection.code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(entries.at(-1)).toMatchObject({ reason: 'expired' });
  });

  it('reicht die Ablehnung der Strategie unverändert weiter', () => {
    const fromStrategy = new SentenzaError(
      SentenzaErrorCode.UNAUTHENTICATED,
      'Das Access-Token ist ungültig.',
    );

    // Die Strategie hat den Grund bereits protokolliert; ein zweiter Eintrag
    // mit weniger Wissen wäre kein Gewinn.
    expect(rejectionOf(() => guard().handleRequest(fromStrategy, false, undefined))).toBe(
      fromStrategy,
    );
  });

  it('nennt in der Antwort keinen Grund und protokolliert kein Token', () => {
    const { guard: instance, entries } = guardWithLog();
    const rejection = rejectionOf(() =>
      instance.handleRequest(null, false, new JsonWebTokenError('invalid signature')),
    );

    // Requirement 9.3: gleichlautende Nachricht für jeden Fall aus
    // Requirement 2.11; Requirement 9.5: kein Token im Protokoll.
    expect(rejection.message).toBe('Für diese Operation ist eine Anmeldung erforderlich.');
    expect(JSON.stringify(entries)).not.toContain('abc.def.ghi');
  });
});

describe('Bereitstellung des Kontos im GraphQL-Kontext', () => {
  /**
   * Die einzige Stelle, an der die Kette vollständig läuft: Kopfzeile,
   * `passport-jwt`, `JwtStrategy.validate`, Guard. Immer noch ohne
   * Nest-Container, ohne Netzzugriff und ohne Datenbank — die Strategie erhält
   * einen Kontospeicher als Double und meldet sich beim Erzeugen selbst bei
   * Passport an.
   */
  function guardWithStrategy(): GqlAuthGuard {
    new JwtStrategy(
      {
        userAccount: {
          findUnique: async ({ where }) => (where.id === ACCOUNT.id ? ACCOUNT : null),
        },
      },
      { jwtSecret: JWT_SECRET },
      createLogger({ component: 'auth', sink: () => undefined }),
    );

    return guard();
  }

  /** Access-Token, wie `TokenIssuer` es ausstellt (Requirement 2.5, 2.6). */
  function accessTokenFor(userAccountId: string): string {
    return new TokenIssuer({
      jwtSecret: JWT_SECRET,
      accessTokenTtlMinutes: 15,
      refreshTokenTtlDays: 30,
    }).issueAccessToken(userAccountId).token;
  }

  /** Kontext samt HTTP-Sicht, wie Passport sie über die Basis anfordert. */
  function requestContextFor(graphqlContext: AuthenticatedGraphQLContext): ExecutionContext {
    const base = contextFor({
      graphqlContext,
      handler: ResolverDouble.prototype.submitPayload,
    }) as ExecutionContext & { switchToHttp?: unknown };

    return Object.assign(base, {
      switchToHttp: () => ({
        getRequest: () => graphqlContext.req,
        getResponse: () => ({}),
        getNext: () => undefined,
      }),
    });
  }

  it('stellt das geprüfte Konto am Kontext bereit', async () => {
    const graphqlContext: AuthenticatedGraphQLContext = {
      req: { headers: { authorization: `Bearer ${accessTokenFor(ACCOUNT.id)}` } },
    } as AuthenticatedGraphQLContext;

    expect(await guardWithStrategy().canActivate(requestContextFor(graphqlContext))).toBe(true);

    // Requirement 2.10: das ermittelte Konto steht für die Dauer der Operation
    // bereit — dort, wo `@CurrentUser()` es liest.
    expect(graphqlContext.user).toEqual(ACCOUNT);
    expect(graphqlContext.req?.user).toEqual(ACCOUNT);
  });

  it('lehnt ein Token ohne bestehendes Benutzerkonto ab und hinterlegt kein Konto', async () => {
    const graphqlContext: AuthenticatedGraphQLContext = {
      req: { headers: { authorization: `Bearer ${accessTokenFor('geloeschtes-konto')}` } },
    } as AuthenticatedGraphQLContext;

    const rejection = await guardWithStrategy()
      .canActivate(requestContextFor(graphqlContext))
      .then(
        () => expect.fail('Erwartet war eine Ablehnung, der Zugang wurde jedoch gewährt.'),
        (error: unknown) => error,
      );

    // Requirement 2.11: nicht zuordenbar ⇒ `UNAUTHENTICATED`, kein Konto im
    // Kontext.
    expect(rejection).toBeInstanceOf(SentenzaError);
    expect((rejection as SentenzaError).code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
    expect(graphqlContext.user).toBeUndefined();
  });
});

/**
 * Feature: backend-busuu-ingestion, Property 29: Jede Operation außer Anmeldung
 * und Erneuerung ist geschützt.
 *
 * **Validates: Requirements 2.10, 2.11**
 *
 * Wahl der Testdatei: Die Eigenschaft spricht nicht über eine einzelne
 * Funktion, sondern über den Bestand der Resolver — „jedes Feld von `Query` und
 * `Mutation`“. Ein solcher Bestand hat keine eigene Quelldatei. Entschieden
 * wird die Aussage jedoch an genau einer Stelle: `GqlAuthGuard` steht global
 * registriert vor jedem Feld, und `@Public()` ist die einzige Ausnahme, die er
 * duldet. Deshalb steht der Test in der Testdatei dieses Guards, dort, wohin
 * die Beispieltests weiter oben bereits verweisen. `JwtStrategy` ist
 * mitgeprüft, weil erst sie über „keinem bestehenden Benutzerkonto
 * zuordenbar“ entscheidet; ihre eigene Testdatei prüft dieselbe Klasse ohne
 * Guard und ohne Datenbank.
 *
 * Diese Eigenschaft läuft gegen die echte Testdatenbank, so wie design.md sie
 * als **[db]** kennzeichnet. Zwei Teile der Aussage verlangen es: Ob ein Token
 * „einem bestehenden Benutzerkonto zuordenbar“ ist, entscheidet ein
 * Lesezugriff auf `UserAccount` — eine Attrappe könnte das nur behaupten und
 * würde damit genau die gestellte Frage beantworten. Und „kein persistierter
 * Datenbestand wird geändert“ ist nur an einem tatsächlich vorhandenen Bestand
 * ablesbar; jeder Durchlauf legt dafür ein Benutzerkonto und einen
 * Refresh-Token-Datensatz an und vergleicht beide vor und nach dem Aufruf.
 *
 * Die erste Achse des Generators ist die Operation. Die Felder von `Query` und
 * `Mutation` werden nicht aufgeschrieben, sondern aus dem erzeugten
 * `schema.gql` gelesen und über die Metadaten von `@Query()` und `@Mutation()`
 * den Methoden der Resolver zugeordnet. Vor den Durchläufen prüft der Test,
 * dass beide Aufzählungen deckungsgleich sind: Ein neues Feld, dessen Resolver
 * nicht in `PROPERTY_29_RESOLVERS` eingetragen ist, lässt den Test
 * fehlschlagen, statt stillschweigend ungeprüft zu bleiben. Darin enthalten
 * sind auch die beiden ausgenommenen Felder — Anmeldung und Erneuerung. Sie
 * traten, solange `AuthResolver` noch nicht existierte, als Attrappen auf; seit
 * Aufgabe 6.12 sind es die echten Felder des echten Resolvers, mit ihrem echten
 * `@Public()`, gelesen von einem echten `Reflector`. Ohne sie wäre nur die eine
 * Seite der Ausnahme geprüft; mit ihnen hält der Test fest, dass `@Public()`
 * durchlässt und alles andere nicht.
 *
 * Die zweite Achse ist das vorgelegte Access-Token. Sie durchmisst die
 * Aufzählung aus Requirement 2.11 und dazu die Fälle, die gerade nicht
 * abgelehnt werden dürfen:
 *
 * - `missing` — keine Kopfzeile `Authorization`, eine leere, eine ohne Wert
 *   und eine mit fremdem Verfahren (`Basic …`).
 * - `unreadable` — Zeichenketten, die kein JWT sind, bis hin zu drei Segmenten
 *   aus base64url-Text, der ausdrücklich kein JSON ist.
 * - `foreign-signature` — richtig gebautes Token, signiert mit einem anderen
 *   Geheimnis.
 * - `foreign-algorithm` — signiert mit HS384, HS512 oder `none`. Ohne die
 *   Festlegung `algorithms: ['HS256']` wäre besonders `none` ein Freifahrtschein.
 * - `foreign-issuer` — gültige Signatur, aber ein `iss`, das nicht `sentenza`
 *   ist, einschließlich der Schreibweise mit Großbuchstaben.
 * - `expired-beyond-tolerance` — Ablaufzeitpunkt um mehr als 60 Sekunden
 *   überschritten.
 * - `unknown-account` — gültiges Token auf eine Konto-Kennung, die es nie gab,
 *   und auf ein nach der Ausstellung entferntes Konto.
 * - `none` und `expired-within-tolerance` — die beiden Lagen, in denen ein
 *   geschütztes Feld erreichbar sein muss. Ohne sie wäre die Eigenschaft von
 *   einem Guard erfüllt, der jede Operation ablehnt, und würde nichts aussagen.
 *
 * Die Grenze der Toleranz meidet der Generator von beiden Seiten um 15
 * Sekunden. Das hat zwei Gründe: Zwischen dem Signieren und der Prüfung
 * verstreicht Zeit, und auf der Sekunde genau liegen Requirement und
 * Bibliothek einen Wimpernschlag auseinander — `jsonwebtoken` lehnt bei genau
 * 60 Sekunden Überschreitung bereits ab, Requirement 2.11 verlangt die
 * Ablehnung erst „um mehr als 60 Sekunden“. Diese eine Sekunde ist
 * ausdrücklich nicht Teil der Aussage und wird deshalb nicht erzeugt.
 *
 * Kein Nest-Abhängigkeitsbaum und kein Netzzugriff: Guard und Strategie werden
 * von Hand instanziiert, `ExecutionContext` und GraphQL-Kontext sind Doubles,
 * der `Reflector` ist echt, damit die Metadaten desselben Dekorators gelesen
 * werden, den die Resolver tragen. Die Zeitquelle der Tokenausstellung ist ein
 * Konstruktorargument; damit ist ein längst abgelaufenes Token ohne Warten und
 * ohne Verstellen der Systemuhr prüfbar. Jeder der 100 Durchläufe setzt den
 * Bestand zu Beginn selbst zurück.
 */

const MILLISECONDS_PER_SECOND = 1_000;
const SECONDS_PER_DAY = 24 * 60 * 60;

/** Die beiden Wurzeltypen, deren Felder Requirement 2.10 nennt. */
const PROPERTY_29_ROOT_TYPES = ['Query', 'Mutation'] as const;

type Property29RootType = (typeof PROPERTY_29_ROOT_TYPES)[number];

/**
 * Die beiden Felder, die Requirement 2.10 ausnimmt: Anmeldung und Erneuerung.
 * Beide können kein Access-Token mitsenden, weil sie es erst ausstellen; sie
 * tragen deshalb `@Public()` an `AuthResolver`.
 *
 * Hier aufgeschrieben und nicht aus dem Dekorator gelesen: Die Aufzählung ist
 * die Erwartung, gegen die geprüft wird. Käme sie aus `@Public()` selbst, wäre
 * jede zusätzliche Ausnahme automatisch zulässig und die Eigenschaft ohne
 * Aussage.
 */
const PROPERTY_29_EXEMPT_FIELDS: ReadonlySet<string> = new Set([
  'signInWithGoogle',
  'refreshAccessToken',
]);

/**
 * Eine Resolver-Klasse, so weit die Aufzählung sie braucht. Bewusst nicht
 * `Function`: Gefragt sind der Prototyp, an dem die Feldmethoden hängen, und
 * die Klasse selbst, die `GqlAuthGuard` als Ebene der Metadaten liest.
 */
interface Property29ResolverClass {
  /**
   * Die Konstruktorstelle nimmt beliebige Argumente an, weil dieser Test
   * niemals einen Resolver erzeugt: Gefragt sind nur die Metadaten. `new ()`
   * ohne Argumente würde jeden Resolver mit Abhängigkeiten ausschließen —
   * `AuthResolver` bekommt Auth_Service in den Konstruktor.
   */
  new (...args: never[]): unknown;
  readonly prototype: object;
  readonly name: string;
}

/**
 * Die Resolver, deren Felder im erzeugten Schema stehen. Ein neuer Resolver
 * gehört hier eingetragen; bis dahin schlägt die Deckungsprüfung gegen
 * `schema.gql` fehl und benennt das ungeprüfte Feld. Die Resolver für
 * Einreichung und Katalog kommen mit den Aufgaben 8 und 13 hinzu.
 */
const PROPERTY_29_RESOLVERS: readonly Property29ResolverClass[] = [AppResolver, AuthResolver];

/** Eine prüfbare Operation: ein Feld des Schemas oder eine ausgenommene Attrappe. */
interface Property29Operation {
  /** Schlüssel im Generator, gleichzeitig die Beschriftung im Gegenbeispiel. */
  readonly key: string;
  readonly field: string;
  readonly handler: () => unknown;
  readonly target: Property29ResolverClass;
  /** Ausgenommen nach Requirement 2.10: Anmeldung und Erneuerung. */
  readonly exempt: boolean;
}

/** Die Felder von `Query` und `Mutation` des erzeugten Schemas, als `Typ.feld`. */
function property29SchemaFieldKeys(): string[] {
  // `schema.gql` ist erzeugt und steht in `.prettierignore`; gelesen wird
  // genau die Datei, die die Anwendung beim Hochfahren schreibt.
  const schema = buildSchema(readFileSync(new URL('../../../schema.gql', import.meta.url), 'utf8'));

  return PROPERTY_29_ROOT_TYPES.flatMap((rootType) => {
    const type = rootType === 'Query' ? schema.getQueryType() : schema.getMutationType();

    return type === null || type === undefined
      ? []
      : Object.keys(type.getFields()).map((field) => `${rootType}.${field}`);
  }).sort();
}

/**
 * Die Felder einer Resolver-Klasse, gelesen aus den Metadaten, die `@Query()`
 * und `@Mutation()` an der Methode hinterlassen. Ohne ausdrücklichen Namen ist
 * der Feldname der Methodenname — dieselbe Regel, nach der NestJS das Schema
 * erzeugt.
 */
function property29OperationsOf(resolver: Property29ResolverClass): Property29Operation[] {
  return Object.getOwnPropertyNames(resolver.prototype).flatMap((methodName) => {
    // Über den Deskriptor gelesen und nicht über den Zugriff am Prototyp: Ein
    // Getter würde sonst beim Aufzählen ausgeführt.
    const handler: unknown = Object.getOwnPropertyDescriptor(resolver.prototype, methodName)?.value;

    if (typeof handler !== 'function') {
      return [];
    }

    // `@Query()` und `@Mutation()` hinterlassen den Wurzeltyp an der Methode;
    // jede andere Methode — `constructor`, ein `@ResolveField()` — fällt hier
    // heraus.
    const rootType: unknown = Reflect.getMetadata(RESOLVER_TYPE_METADATA, handler);

    if (!PROPERTY_29_ROOT_TYPES.includes(rootType as Property29RootType)) {
      return [];
    }

    const field =
      (Reflect.getMetadata(RESOLVER_NAME_METADATA, handler) as string | undefined) ?? methodName;

    return [
      {
        key: `${String(rootType)}.${field}`,
        field,
        handler: handler as () => unknown,
        target: resolver,
        exempt: PROPERTY_29_EXEMPT_FIELDS.has(field),
      },
    ];
  });
}

/** Die Felder aller eingetragenen Resolver, als `Typ.feld`. */
const PROPERTY_29_SCHEMA_OPERATIONS: readonly Property29Operation[] =
  PROPERTY_29_RESOLVERS.flatMap(property29OperationsOf);

const PROPERTY_29_OPERATIONS_BY_KEY = new Map<string, Property29Operation>(
  PROPERTY_29_SCHEMA_OPERATIONS.map((operation) => [operation.key, operation]),
);

const PROPERTY_29_OPERATION_KEYS = [...PROPERTY_29_OPERATIONS_BY_KEY.keys()];

function property29Operation(key: string): Property29Operation {
  const operation = PROPERTY_29_OPERATIONS_BY_KEY.get(key);

  if (operation === undefined) {
    throw new Error(`Unbekannte Operation im Generator: ${key}`);
  }

  return operation;
}

/** Die Tokenlagen aus Requirement 2.11, dazu die beiden zulässigen. */
type Property29Defect =
  | 'none'
  | 'expired-within-tolerance'
  | 'missing'
  | 'unreadable'
  | 'foreign-signature'
  | 'foreign-algorithm'
  | 'foreign-issuer'
  | 'expired-beyond-tolerance'
  | 'unknown-account';

const PROPERTY_29_DEFECTS: readonly Property29Defect[] = [
  'none',
  'expired-within-tolerance',
  'missing',
  'unreadable',
  'foreign-signature',
  'foreign-algorithm',
  'foreign-issuer',
  'expired-beyond-tolerance',
  'unknown-account',
];

/** Die beiden Lagen, in denen ein geschütztes Feld erreichbar sein muss. */
const PROPERTY_29_ACCEPTED_DEFECTS = new Set<Property29Defect>([
  'none',
  'expired-within-tolerance',
]);

/**
 * Abstand zur Toleranzgrenze in Sekunden, von beiden Seiten gemieden: Zwischen
 * Ausstellung und Prüfung verstreicht Zeit, und bei genau 60 Sekunden liegen
 * Requirement und Bibliothek um eine Sekunde auseinander.
 */
const PROPERTY_29_TOLERANCE_MARGIN_SECONDS = 15;

/** Die Ausstellung, mit der jeder Durchlauf sein Access-Token baut (Requirement 2.6). */
const PROPERTY_29_ISSUER_SETTINGS: TokenIssuerSettings = {
  jwtSecret: JWT_SECRET,
  accessTokenTtlMinutes: 15,
  refreshTokenTtlDays: 30,
};

const PROPERTY_29_ACCESS_TOKEN_TTL_SECONDS = PROPERTY_29_ISSUER_SETTINGS.accessTokenTtlMinutes * 60;

/** Das Konto, das jeder Durchlauf anlegt und auf das das gültige Token zeigt. */
const PROPERTY_29_GOOGLE_SUBJECT = '110000000000000000029';
const PROPERTY_29_EMAIL = 'lernende@example.com';

/**
 * Ein Refresh-Token-Datensatz als Wächter: Der Guard hat keinen Schreibpfad,
 * und dieser Datensatz hält das fest, statt die Zusage an einer leeren Tabelle
 * zu prüfen.
 */
const PROPERTY_29_SENTINEL_TOKEN_HASH = 'a'.repeat(64);

/**
 * Die beiden Nachrichten, mit denen abgelehnt wird: eine von `GqlAuthGuard`,
 * eine von `JwtStrategy`. Beide nennen keinen Grund — welcher zutrifft, steht
 * ausschließlich im Protokoll (Requirement 9.3).
 */
const PROPERTY_29_UNAUTHENTICATED_MESSAGES: readonly string[] = [
  'Für diese Operation ist eine Anmeldung erforderlich.',
  'Das Access-Token ist ungültig.',
];

/** Segment einer unlesbaren Zeichenkette: base64url eines Textes, der kein JSON ist. */
const property29GarbageSegmentArb: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 12 })
  .map((value) => Buffer.from(`nicht-json-${value}`, 'utf8').toString('base64url'));

/** Zeichenketten, die kein lesbares JWT sind (Requirement 2.11: syntaktisch unlesbar). */
const property29UnreadableTokenArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant('kein.jwt'),
  fc.constant('...'),
  fc.constant('eyJhbGciOiJIUzI1NiJ9'),
  fc.string({ minLength: 1, maxLength: 40 }).map((value) => value.replaceAll(/[.\s]/g, '-')),
  fc
    .tuple(property29GarbageSegmentArb, property29GarbageSegmentArb, property29GarbageSegmentArb)
    .map(([header, payload, signature]) => `${header}.${payload}.${signature}`),
);

/** Ein erzeugter Aufruf: die Operation, die Tokenlage und alle Werte, die sie braucht. */
interface Property29Scenario {
  readonly operationKey: string;
  readonly defect: Property29Defect;
  /** Kopfzeile ohne vorlagefähiges Token; `undefined` heißt: gar keine Kopfzeile. */
  readonly headerWithoutToken: string | undefined;
  readonly unreadableToken: string;
  readonly foreignSecret: string;
  readonly foreignAlgorithm: Algorithm;
  readonly foreignIssuer: string;
  /** Nie vergeben oder nach der Ausstellung entfernt. */
  readonly unknownAccount: 'never-existed' | 'removed';
  readonly unknownSubject: string;
  readonly withinToleranceSeconds: number;
  readonly beyondToleranceSeconds: number;
}

const property29ScenarioArb: fc.Arbitrary<Property29Scenario> = fc.record({
  operationKey: fc.constantFrom(...PROPERTY_29_OPERATION_KEYS),
  defect: fc.constantFrom(...PROPERTY_29_DEFECTS),
  headerWithoutToken: fc.constantFrom<string | undefined>(
    undefined,
    '',
    '   ',
    'Bearer',
    'Bearer ',
    'Basic bnV0emVyOmdlaGVpbQ==',
    'Token abc.def.ghi',
  ),
  unreadableToken: property29UnreadableTokenArb,
  foreignSecret: fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value !== JWT_SECRET),
  foreignAlgorithm: fc.constantFrom<Algorithm>('HS384', 'HS512', 'none'),
  foreignIssuer: fc.constantFrom(
    '',
    'SENTENZA',
    'sentenza-test',
    'https://accounts.google.com',
    'https://sentenza.example.evil',
  ),
  unknownAccount: fc.constantFrom('never-existed', 'removed'),
  unknownSubject: fc.oneof(
    fc.uuid(),
    fc.constantFrom('', '   ', 'kein-konto', '00000000-0000-0000-0000-000000000000'),
  ),
  withinToleranceSeconds: fc.integer({
    min: 1,
    max: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS - PROPERTY_29_TOLERANCE_MARGIN_SECONDS,
  }),
  beyondToleranceSeconds: fc.integer({
    min: ACCESS_TOKEN_CLOCK_TOLERANCE_SECONDS + PROPERTY_29_TOLERANCE_MARGIN_SECONDS,
    max: 30 * SECONDS_PER_DAY,
  }),
});

/**
 * Signiert Ansprüche unmittelbar — für die beiden Lagen, die `TokenIssuer`
 * nicht herstellen kann, weil er ausschließlich HS256 und `iss: 'sentenza'`
 * kennt. Die Ansprüche sind dieselben wie dort (design.md, "Access-Token").
 */
function property29SignedToken(options: {
  subject: string;
  now: Date;
  issuer?: string;
  secret?: string;
  algorithm?: Algorithm;
}): string {
  const issuedAtSeconds = Math.floor(options.now.getTime() / MILLISECONDS_PER_SECOND);

  return signJwt(
    {
      sub: options.subject,
      iss: options.issuer ?? ACCESS_TOKEN_ISSUER,
      iat: issuedAtSeconds,
      exp: issuedAtSeconds + PROPERTY_29_ACCESS_TOKEN_TTL_SECONDS,
    },
    // `none` verlangt ein leeres Geheimnis; genau darin liegt die Gefahr, die
    // `algorithms: ['HS256']` ausschließt.
    options.algorithm === 'none' ? '' : (options.secret ?? JWT_SECRET),
    { algorithm: options.algorithm ?? ACCESS_TOKEN_ALGORITHM },
  );
}

/**
 * Das Token, das der Durchlauf vorlegt; `undefined` heißt: keines. Ein
 * abgelaufenes Token entsteht über eine in die Vergangenheit gelegte
 * Zeitquelle der Ausstellung, nicht über eine verstellte Systemuhr.
 */
function property29PresentedToken(
  scenario: Property29Scenario,
  userAccountId: string,
  now: Date,
): string | undefined {
  const issuerAt = (clock: Date, jwtSecret: string = JWT_SECRET): TokenIssuer =>
    new TokenIssuer({ ...PROPERTY_29_ISSUER_SETTINGS, jwtSecret }, () => clock);

  const expiredAt = (secondsPastExpiry: number): Date =>
    new Date(
      now.getTime() -
        (PROPERTY_29_ACCESS_TOKEN_TTL_SECONDS + secondsPastExpiry) * MILLISECONDS_PER_SECOND,
    );

  switch (scenario.defect) {
    case 'none':
      return issuerAt(now).issueAccessToken(userAccountId).token;

    case 'expired-within-tolerance':
      return issuerAt(expiredAt(scenario.withinToleranceSeconds)).issueAccessToken(userAccountId)
        .token;

    case 'expired-beyond-tolerance':
      return issuerAt(expiredAt(scenario.beyondToleranceSeconds)).issueAccessToken(userAccountId)
        .token;

    case 'missing':
      return undefined;

    case 'unreadable':
      return scenario.unreadableToken;

    case 'foreign-signature':
      return issuerAt(now, scenario.foreignSecret).issueAccessToken(userAccountId).token;

    case 'foreign-algorithm':
      return property29SignedToken({
        subject: userAccountId,
        now,
        algorithm: scenario.foreignAlgorithm,
      });

    case 'foreign-issuer':
      return property29SignedToken({ subject: userAccountId, now, issuer: scenario.foreignIssuer });

    case 'unknown-account':
      // Die Kennung eines entfernten Kontos ist ein tadellos ausgestelltes
      // Token; entfernt wird das Konto erst nach der Ausstellung.
      return issuerAt(now).issueAccessToken(
        scenario.unknownAccount === 'removed' ? userAccountId : scenario.unknownSubject,
      ).token;
  }
}

/** Die Kopfzeile, mit der der Durchlauf antritt. */
function property29Headers(
  scenario: Property29Scenario,
  token: string | undefined,
): Record<string, string> {
  if (token !== undefined) {
    return { authorization: `Bearer ${token}` };
  }

  return scenario.headerWithoutToken === undefined
    ? {}
    : { authorization: scenario.headerWithoutToken };
}

/**
 * Der `ExecutionContext` der Operation. `switchToHttp` kommt hinzu, weil die
 * Basis von `AuthGuard` die Antwort dort abholt; die Anfrage liest
 * `GqlAuthGuard` ausdrücklich aus dem GraphQL-Kontext.
 */
function property29Context(
  operation: Property29Operation,
  graphqlContext: AuthenticatedGraphQLContext,
): ExecutionContext {
  const base = contextFor({
    graphqlContext,
    handler: operation.handler,
    target: operation.target,
  });

  return Object.assign(base, {
    switchToHttp: () => ({
      getRequest: () => graphqlContext.req,
      getResponse: () => ({}),
      getNext: () => undefined,
    }),
  });
}

/** Der Teil des Bestands, den keine abgelehnte und keine zugelassene Operation ändern darf. */
interface Property29StoredState {
  readonly accounts: { id: string; googleSubject: string; email: string }[];
  readonly refreshTokens: { tokenHash: string; userAccountId: string; revokedAt: Date | null }[];
}

async function property29StoredState(prisma: PrismaClient): Promise<Property29StoredState> {
  return {
    accounts: await prisma.userAccount.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, googleSubject: true, email: true },
    }),
    refreshTokens: await prisma.refreshToken.findMany({
      orderBy: { tokenHash: 'asc' },
      select: { tokenHash: true, userAccountId: true, revokedAt: true },
    }),
  };
}

/**
 * Hundert Durchläufe mit Reset, Anlage und Prüfung gegen eine echte Datenbank
 * brauchen mehr als die voreingestellten fünf Sekunden von Vitest.
 */
const PROPERTY_29_TIMEOUT_MS = 120_000;

describe('GqlAuthGuard (Property 29)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = createTestDatabaseClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it(
    'lehnt jedes Feld von Query und Mutation außer Anmeldung und Erneuerung bei jedem Tokendefekt mit UNAUTHENTICATED ab, gibt kein Konto heraus und ändert den Bestand nicht',
    async () => {
      // Die Aufzählung ist vollständig: Jedes Feld des erzeugten Schemas hat
      // einen bekannten Handler, und jeder bekannte Handler steht im Schema.
      expect(PROPERTY_29_SCHEMA_OPERATIONS.map((operation) => operation.key).sort()).toEqual(
        property29SchemaFieldKeys(),
      );

      // Beide Seiten der Ausnahme sind vertreten: Ohne ein ausgenommenes Feld
      // in der Aufzählung wäre die Eigenschaft von einem Guard erfüllt, der
      // alles ablehnt, und Requirement 2.10 nur zur Hälfte geprüft.
      expect(
        PROPERTY_29_SCHEMA_OPERATIONS.filter((operation) => operation.exempt)
          .map((operation) => operation.field)
          .sort(),
      ).toEqual([...PROPERTY_29_EXEMPT_FIELDS].sort());

      const silent = createLogger({ component: 'auth', sink: () => undefined });

      // Die Strategie meldet sich beim Erzeugen unter `jwt` bei Passport an und
      // liest das Konto aus der Testdatenbank; der Guard findet sie darüber.
      new JwtStrategy(prisma, { jwtSecret: JWT_SECRET }, silent);
      const instance = new GqlAuthGuard(new Reflector(), silent);

      await fc.assert(
        fc.asyncProperty(property29ScenarioArb, async (scenario) => {
          const operation = property29Operation(scenario.operationKey);

          await resetDatabase(prisma);

          const now = new Date();
          const account = await prisma.userAccount.create({
            data: { googleSubject: PROPERTY_29_GOOGLE_SUBJECT, email: PROPERTY_29_EMAIL },
          });
          await prisma.refreshToken.create({
            data: {
              userAccountId: account.id,
              tokenHash: PROPERTY_29_SENTINEL_TOKEN_HASH,
              expiresAt: new Date(now.getTime() + 30 * SECONDS_PER_DAY * MILLISECONDS_PER_SECOND),
            },
          });

          const token = property29PresentedToken(scenario, account.id, now);

          if (scenario.defect === 'unknown-account' && scenario.unknownAccount === 'removed') {
            // `onDelete: Cascade` nimmt den Wächter-Datensatz mit; der Bestand
            // wird deshalb erst danach abgelesen.
            await prisma.userAccount.delete({ where: { id: account.id } });
          }

          const graphqlContext = {
            req: { headers: property29Headers(scenario, token) },
          } as AuthenticatedGraphQLContext;
          const stateBefore = await property29StoredState(prisma);

          // Erreichbar ist ein Feld genau dann, wenn es ausgenommen ist oder
          // ein tadelloses Token vorliegt.
          const expectedGranted =
            operation.exempt || PROPERTY_29_ACCEPTED_DEFECTS.has(scenario.defect);

          let granted = false;
          let caught: unknown;
          try {
            granted = await instance.canActivate(property29Context(operation, graphqlContext));
          } catch (error) {
            caught = error;
          }

          if (expectedGranted) {
            expect(caught).toBeUndefined();
            expect(granted).toBe(true);

            if (operation.exempt) {
              // Ein ausgenommenes Feld wird ohne Prüfung durchgelassen und
              // erfährt deshalb kein Konto.
              expect(graphqlContext.user).toBeUndefined();
            } else {
              // Requirement 2.10: das ermittelte Konto steht für die Dauer der
              // Operation bereit.
              expect(graphqlContext.user).toEqual({ id: account.id, email: account.email });
            }
          } else {
            // Requirement 2.11: Ablehnung mit `UNAUTHENTICATED`, ohne einen
            // Grund zu nennen.
            expect(granted).toBe(false);
            expect(caught).toBeInstanceOf(SentenzaError);
            expect((caught as SentenzaError).code).toBe(SentenzaErrorCode.UNAUTHENTICATED);
            expect(PROPERTY_29_UNAUTHENTICATED_MESSAGES).toContain(
              (caught as SentenzaError).message,
            );

            // Keine Nutzerdaten: weder am GraphQL-Kontext, wo `@CurrentUser()`
            // liest, noch an der Anfrage, wo Passport ablegt.
            expect(graphqlContext.user).toBeUndefined();
            expect(graphqlContext.req?.user).toBeUndefined();
          }

          // In beiden Fällen unverändert: Der Guard liest das Konto, er
          // schreibt nichts.
          expect(await property29StoredState(prisma)).toEqual(stateBefore);
        }),
        { numRuns: 100 },
      );
    },
    PROPERTY_29_TIMEOUT_MS,
  );
});
