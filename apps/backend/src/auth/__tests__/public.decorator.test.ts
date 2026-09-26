import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { IS_PUBLIC_KEY, Public } from '../public.decorator.js';

/**
 * Tests für `@Public()` (design.md, Abschnitt "Guard und Request-Kontext").
 *
 * Gelesen wird mit einem echten `Reflector` und genau dem Aufruf, den
 * `GqlAuthGuard` verwendet: Ein Dekorator, dessen Metadaten der Guard nicht
 * findet, wäre eine lautlos unwirksame Ausnahme — beziehungsweise, an der
 * Anmelde-Mutation, eine lautlos unmögliche Anmeldung.
 */

/** Liest die Ausnahme so, wie `GqlAuthGuard.isPublic` es tut. */
function isPublic(handler: unknown, target: unknown): boolean {
  return (
    new Reflector().getAllAndOverride<boolean>(IS_PUBLIC_KEY, [handler, target] as never) === true
  );
}

class PartiallyPublic {
  @Public()
  signInWithGoogle(): void {
    // ausgenommen
  }

  submitPayload(): void {
    // geschützt
  }
}

@Public()
class FullyPublic {
  check(): void {
    // ausgenommen über die Klasse
  }
}

class NothingPublic {
  listRawPayloads(): void {
    // geschützt
  }
}

describe('@Public()', () => {
  it('nimmt das dekorierte Feld aus', () => {
    expect(isPublic(PartiallyPublic.prototype.signInWithGoogle, PartiallyPublic)).toBe(true);
  });

  it('lässt ein Feld ohne Dekorator geschützt, auch in derselben Klasse', () => {
    // Die Ausnahme wirkt je Feld und nicht für die ganze Klasse, sobald ein
    // einziges Feld sie trägt.
    expect(isPublic(PartiallyPublic.prototype.submitPayload, PartiallyPublic)).toBe(false);
  });

  it('nimmt jedes Feld einer dekorierten Klasse aus', () => {
    expect(isPublic(FullyPublic.prototype.check, FullyPublic)).toBe(true);
  });

  it('lässt eine Klasse ohne Dekorator geschützt', () => {
    // Der Vorgabezustand: Wer nichts hinschreibt, ist geschützt
    // (Requirement 2.10).
    expect(isPublic(NothingPublic.prototype.listRawPayloads, NothingPublic)).toBe(false);
  });

  it('hinterlegt den Wahrheitswert unter dem vereinbarten Schlüssel', () => {
    // Der Schlüssel ist die Schnittstelle zwischen Dekorator und Guard; ein
    // stiller Umbau hier würde jede Ausnahme unwirksam machen.
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, PartiallyPublic.prototype.signInWithGoogle) as unknown,
    ).toBe(true);
  });
});
