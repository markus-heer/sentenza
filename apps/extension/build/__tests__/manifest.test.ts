import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUSUU_MATCH_PATTERNS,
  type ChromeManifest,
  DEFAULT_BACKEND_URL,
  REQUIRED_PERMISSIONS,
  resolveManifest,
  toBackendHostPermission,
} from '../manifest';

/**
 * Prüft die Zusagen des Manifests aus Requirement 8.1 und 8.5 gegen die
 * eingecheckte Quelle `apps/extension/manifest.json` und gegen das daraus
 * gebaute Manifest.
 *
 * Prüfbar ist hier alles, was das Manifest selbst zusagt: der Umfang der
 * Berechtigungen, die beiden Welten mit ihrem Startzeitpunkt, der Service
 * Worker als Modul und das Popup. Nicht prüfbar ist, was erst der Quelltext
 * dahinter leistet — dass zu `document_start` tatsächlich vor dem ersten
 * Netzwerkaufruf umhüllt wird (Aufgabe 16.5), dass die Brücke nur zutreffende
 * Inhalte weiterreicht (16.3, 16.7) und dass ausschließlich Antwortinhalte
 * passender Endpunkte übertragen werden (Eigenschaft 41). Diese Zusagen prüfen
 * die Tests der Folgeaufgaben. Der repositoryweite Strukturtest gegen eine
 * Wildcard-Host-Berechtigung folgt in Aufgabe 17.2.
 */

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function readManifestSource(): unknown {
  return JSON.parse(readFileSync(resolve(packageDir, 'manifest.json'), 'utf8'));
}

function build(backendUrl = DEFAULT_BACKEND_URL): ChromeManifest {
  return resolveManifest(readManifestSource(), { backendUrl });
}

describe('manifest.json', () => {
  it('erfüllt die Zusagen des Schemas und ist damit nach Manifest V3 gebaut', () => {
    expect(build().manifest_version).toBe(3);
  });

  it('deklariert genau die drei benötigten Berechtigungen', () => {
    expect([...build().permissions].sort()).toEqual([...REQUIRED_PERMISSIONS].sort());
  });

  it('beschränkt die Host-Berechtigungen auf die Busuu-Domänen und das Backend', () => {
    expect(build().host_permissions).toEqual([...BUSUU_MATCH_PATTERNS, 'http://localhost:4000/*']);
  });

  it('deklariert keine Berechtigung für alle Adressen', () => {
    for (const hostPermission of build().host_permissions) {
      expect(hostPermission).not.toBe('<all_urls>');
      expect(hostPermission).not.toMatch(/^\*:\/\//);
      // Ein Platzhalter darf nur als Unterdomänen-Platzhalter vorkommen, also
      // ausschließlich unmittelbar vor einem Punkt oder als Pfadangabe.
      expect(hostPermission).not.toMatch(/:\/\/\*\//);
    }
  });

  it('führt den Service Worker als Modul', () => {
    expect(build().background).toEqual({
      service_worker: 'background/index.js',
      type: 'module',
    });
  });

  it('bindet das Popup ein', () => {
    expect(build().action.default_popup).toBe('popup/index.html');
  });

  it('fängt in beiden Welten zu document_start ab', () => {
    const contentScripts = build().content_scripts;

    expect(contentScripts.map((entry) => entry.world).sort()).toEqual(['ISOLATED', 'MAIN']);
    for (const entry of contentScripts) {
      expect(entry.run_at).toBe('document_start');
      expect(entry.matches).toEqual([...BUSUU_MATCH_PATTERNS]);
    }
  });

  it('lädt je Welt genau eine Datei, im Seitenkontext den Haken und isoliert die Brücke', () => {
    const contentScripts = build().content_scripts;

    expect(contentScripts.find((entry) => entry.world === 'MAIN')?.js).toEqual(['inject/hook.js']);
    expect(contentScripts.find((entry) => entry.world === 'ISOLATED')?.js).toEqual([
      'content/bridge.js',
    ]);
  });
});

describe('toBackendHostPermission', () => {
  it('leitet aus der Adresse der GraphQL_API deren Ursprung ab', () => {
    expect(toBackendHostPermission('http://localhost:4000/graphql')).toBe(
      'http://localhost:4000/*',
    );
    expect(toBackendHostPermission('https://sentenza.example:8443/graphql')).toBe(
      'https://sentenza.example:8443/*',
    );
  });

  it('weist eine Adresse ohne gültige Gestalt zurück und benennt die Variable', () => {
    expect(() => toBackendHostPermission('localhost:4000')).toThrow(/SENTENZA_BACKEND_URL/);
  });

  it('weist einen Platzhalter im Host zurück, weil er die Berechtigung ausweitete', () => {
    expect(() => toBackendHostPermission('http://*/graphql')).toThrow(/Platzhalter/);
  });

  it('weist ein anderes Schema als http oder https zurück', () => {
    expect(() => toBackendHostPermission('ftp://localhost:4000/graphql')).toThrow(/http/);
  });
});

describe('resolveManifest', () => {
  it('setzt die Host-Berechtigung des Backends aus der Konfiguration', () => {
    expect(build('https://sentenza.example/graphql').host_permissions).toEqual([
      ...BUSUU_MATCH_PATTERNS,
      'https://sentenza.example/*',
    ]);
  });

  it('ersetzt die Host-Berechtigungen der Quelle, statt sie zu ergänzen', () => {
    const widened = {
      ...(readManifestSource() as Record<string, unknown>),
      host_permissions: ['<all_urls>', 'https://*.busuu.com/*'],
    };

    expect(resolveManifest(widened, { backendUrl: DEFAULT_BACKEND_URL }).host_permissions).toEqual([
      ...BUSUU_MATCH_PATTERNS,
      'http://localhost:4000/*',
    ]);
  });

  it('weist eine zusätzliche Berechtigung zurück', () => {
    const widened = {
      ...(readManifestSource() as Record<string, unknown>),
      permissions: ['storage', 'identity', 'alarms', 'tabs'],
    };

    expect(() => resolveManifest(widened, { backendUrl: DEFAULT_BACKEND_URL })).toThrow();
  });

  it('weist einen Content-Script-Eintrag ohne document_start zurück', () => {
    const source = readManifestSource() as { content_scripts: { run_at: string }[] };
    const delayed = {
      ...source,
      content_scripts: source.content_scripts.map((entry) => ({
        ...entry,
        run_at: 'document_idle',
      })),
    };

    expect(() => resolveManifest(delayed, { backendUrl: DEFAULT_BACKEND_URL })).toThrow();
  });

  it('weist einen klassischen Service Worker ohne Modulangabe zurück', () => {
    const classic = {
      ...(readManifestSource() as Record<string, unknown>),
      background: { service_worker: 'background/index.js' },
    };

    expect(() => resolveManifest(classic, { backendUrl: DEFAULT_BACKEND_URL })).toThrow();
  });
});
