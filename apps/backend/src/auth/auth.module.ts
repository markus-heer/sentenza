import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { createLogger, type SentenzaLogger } from '../common/logger.js';
import { SENTENZA_CONFIG } from '../config/config.module.js';
import type { SentenzaConfig } from '../config/configuration.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthResolver } from './auth.resolver.js';
import { AuthService } from './auth.service.js';
import { GoogleTokenVerifier } from './google-token.verifier.js';
import { GqlAuthGuard } from './gql-auth.guard.js';
import { JwtStrategy } from './jwt.strategy.js';
import { TokenIssuer } from './token-issuer.js';

/**
 * Protokollstelle des gesamten Auth-Moduls. Ein Provider und nicht ein
 * Vorgabewert je Klasse: So wirkt `LOG_LEVEL` auch für die Auth-Einträge, und
 * jeder Eintrag trägt dieselbe Komponente.
 */
const AUTH_LOGGER = 'AUTH_LOGGER';

/**
 * Auth-Modul (Requirement 2; design.md, Abschnitt "Auth-Modul").
 *
 * Alle Provider entstehen über Factories und nicht über `providers: [Klasse]`.
 * Das ist keine Vorliebe, sondern die Folge zweier Entscheidungen des Entwurfs:
 * Die Klassen nehmen Schnittstellen als Abhängigkeiten, die Nest zur Laufzeit
 * nicht auflösen könnte, und ihre Teilmengen der Konfiguration kommen als
 * einfache Werte. Der Nebeneffekt ist der eigentliche Gewinn — der Type-Check
 * prüft an dieser Stelle, dass `PrismaService` die von `AuthStore` und
 * `AccessTokenStore` verlangte Form erfüllt. Ändert Prisma eine Signatur,
 * schlägt der Build hier fehl statt der Betrieb zur Laufzeit.
 *
 * `PassportModule` ist eingebunden, weil `GqlAuthGuard` von `AuthGuard('jwt')`
 * erbt; die Strategie meldet sich beim Anlegen ihres Providers unter dem Namen
 * `jwt` bei Passport an.
 *
 * `AuthResolver` trägt die Anmelde- und die Erneuerungs-Mutation
 * (Requirement 2.5, 2.9). Er steht in `providers` und nicht in einem eigenen
 * Modul, weil `GraphQLModule` die Resolver über die Provider aller Module
 * einsammelt; ein Export ist dafür nicht nötig.
 *
 * `APP_GUARD` registriert `GqlAuthGuard` global (Requirement 2.10; design.md:
 * "der Guard ist global registriert, sodass jede neue Operation standardmäßig
 * geschützt ist"). Die Registrierung steht hier und nicht im `AppModule`, damit
 * sie zusammen mit der Strategie und dem Dekorator `@Public()` an einer Stelle
 * zu lesen ist; `AppModule` muss dafür nur dieses Modul einbinden.
 */
@Module({
  imports: [PassportModule],
  providers: [
    {
      provide: AUTH_LOGGER,
      inject: [SENTENZA_CONFIG],
      useFactory: (config: SentenzaConfig): SentenzaLogger =>
        createLogger({ component: 'auth', level: config.logLevel }),
    },
    {
      provide: GoogleTokenVerifier,
      inject: [SENTENZA_CONFIG, AUTH_LOGGER],
      useFactory: (config: SentenzaConfig, logger: SentenzaLogger) =>
        // Der JWKS-gestützte Schlüssellieferant ist der Vorgabewert des
        // Konstruktors; im Betrieb ist genau er gewollt.
        new GoogleTokenVerifier(config.google, undefined, logger),
    },
    {
      provide: TokenIssuer,
      inject: [SENTENZA_CONFIG],
      useFactory: (config: SentenzaConfig) => new TokenIssuer(config.auth),
    },
    {
      provide: AuthService,
      inject: [PrismaService, GoogleTokenVerifier, TokenIssuer, SENTENZA_CONFIG, AUTH_LOGGER],
      useFactory: (
        prisma: PrismaService,
        googleTokenVerifier: GoogleTokenVerifier,
        tokenIssuer: TokenIssuer,
        config: SentenzaConfig,
        logger: SentenzaLogger,
      ) => new AuthService(prisma, googleTokenVerifier, tokenIssuer, config.auth, logger),
    },
    {
      // Wird angelegt, ohne irgendwo injiziert zu werden: Der Konstruktor der
      // Mixin-Basis meldet die Strategie unter `jwt` bei Passport an, und erst
      // dadurch findet `GqlAuthGuard` sie. Nest legt Provider eines Moduls beim
      // Hochfahren an, deshalb genügt dieser Eintrag.
      provide: JwtStrategy,
      inject: [PrismaService, SENTENZA_CONFIG, AUTH_LOGGER],
      useFactory: (prisma: PrismaService, config: SentenzaConfig, logger: SentenzaLogger) =>
        new JwtStrategy(prisma, config.auth, logger),
    },
    {
      provide: APP_GUARD,
      inject: [Reflector, AUTH_LOGGER],
      useFactory: (reflector: Reflector, logger: SentenzaLogger) =>
        new GqlAuthGuard(reflector, logger),
    },
    {
      // Auch der Resolver entsteht über eine Factory, obwohl `providers:
      // [AuthResolver]` hier genügen würde: Sein Konstruktor verlangt
      // `AuthResolverService`, eine Schnittstelle, die Nest zur Laufzeit nicht
      // auflösen könnte. Der Gewinn ist derselbe wie bei den übrigen
      // Einträgen — der Type-Check prüft an dieser Stelle, dass `AuthService`
      // die beiden verlangten Verfahren in der verlangten Form mitbringt.
      provide: AuthResolver,
      inject: [AuthService],
      useFactory: (authService: AuthService) => new AuthResolver(authService),
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
