import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckResult, HealthCheckService } from '@nestjs/terminus';

import { Public } from '../auth/public.decorator.js';
import { DatabaseHealthIndicator } from './database.health.js';

/**
 * `GET /health` (Requirement 9.7, design.md Abschnitt "Health-Endpunkt").
 *
 * Bewusst ohne Anmeldung: Der Endpunkt dient der Prüfung der
 * Betriebsbereitschaft und muss auch dann antworten, wenn keine Anmeldung
 * möglich ist. Er gibt ausschließlich den Zustand der geprüften Abhängigkeiten
 * zurück und keine Nutzerdaten; Requirement 2.10 bezieht den Guard-Zwang
 * ausdrücklich auf Queries und Mutationen der GraphQL_API.
 *
 * `@Public()` ist dafür nötig, seit `GqlAuthGuard` über `APP_GUARD` global
 * registriert ist (Aufgabe 6.10): Ein globaler Guard greift auch auf
 * HTTP-Controller. Der Dekorator steht an der Klasse und damit für jede Route
 * dieses Controllers. Die Ausnahme ist damit hier sichtbar statt in einer
 * Ausnahmeliste im Guard versteckt — und jede andere Route bleibt geschützt,
 * ohne dass jemand daran denken muss.
 *
 * `HealthCheckService.check` beantwortet ein `down`-Ergebnis mit HTTP 503 und
 * einem Körper, der den Gesamtzustand `error` sowie die betroffene
 * Abhängigkeit nennt (Requirement 9.9). `@HealthCheck()` unterbindet zusätzlich
 * das Zwischenspeichern der Antwort.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthCheck: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.healthCheck.check([() => this.database.check()]);
  }
}
