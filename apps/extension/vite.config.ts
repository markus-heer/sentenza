import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, loadEnv, type Plugin, type UserConfig } from 'vite';

import { DEFAULT_BACKEND_URL, resolveManifest } from './build/manifest';

/**
 * Build von Sentenza_Extension nach `dist` (Requirement 8.1, 8.5).
 *
 * Manifest V3 verträgt für Content Scripts keine Aufteilung in dynamisch
 * geladene Bündel: Ein Content Script wird als klassisches Skript ausgeführt,
 * ein `import` darin schlägt zur Laufzeit fehl. Rollup erzeugt bei mehreren
 * ES-Einstiegspunkten aber genau das, sobald zwei Einstiegspunkte ein Modul
 * gemeinsam nutzen — und das werden `inject/hook.ts` und `content/bridge.ts`
 * mit den Folgeaufgaben tun (`shared/endpoints.ts`, `shared/messages.ts`).
 *
 * Deshalb baut dieses Paket in drei Durchläufen, gesteuert über den Vite-Modus:
 *
 * | Modus            | Einstiegspunkte                      | Format |
 * | ---------------- | ------------------------------------ | ------ |
 * | (Vorgabe)        | `background/index.ts`, `popup/index.ts` | ES   |
 * | `content-hook`   | `inject/hook.ts`                     | IIFE   |
 * | `content-bridge` | `content/bridge.ts`                  | IIFE   |
 *
 * Service Worker und Popup dürfen ES-Module sein — der Service Worker ist im
 * Manifest als `"type": "module"` deklariert, das Popup lädt sein Skript über
 * `<script type="module">`. Beide dürfen sich daher Bündel teilen. Die beiden
 * Content Scripts werden je in einem eigenen Durchlauf zu genau einer
 * eigenständigen IIFE-Datei ohne Fremdverweise gebündelt; `format: 'iife'`
 * erlaubt nur einen Einstiegspunkt je Durchlauf, was die Trennung erzwingt.
 *
 * Nur der erste Durchlauf leert `dist` und schreibt Manifest und Popup-
 * Dokument; die beiden folgenden ergänzen ihre Datei.
 */

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageDir, '../..');
const srcDir = resolve(packageDir, 'src');

/**
 * Schreibt `dist/manifest.json` aus der eingecheckten Quelle, mit der
 * Host-Berechtigung des konfigurierten Backends.
 */
function emitManifest(backendUrl: string): Plugin {
  return {
    name: 'sentenza-emit-manifest',
    generateBundle() {
      const source: unknown = JSON.parse(
        readFileSync(resolve(packageDir, 'manifest.json'), 'utf8'),
      );
      const manifest = resolveManifest(source, { backendUrl });

      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

/**
 * Kopiert das Popup-Dokument unverändert nach `dist/popup/index.html`.
 *
 * Das Dokument verweist mit `./index.js` auf das gebündelte Popup-Skript.
 * Bewusst kein HTML-Einstiegspunkt von Vite: Der würde den Skriptnamen selbst
 * bestimmen, während das Manifest und die Erweiterung feste, unverhashte Pfade
 * brauchen.
 */
function emitPopupDocument(): Plugin {
  return {
    name: 'sentenza-emit-popup-document',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'popup/index.html',
        source: readFileSync(resolve(srcDir, 'popup/index.html'), 'utf8'),
      });
    },
  };
}

/** Einstiegspunkte der beiden Content Scripts, je Modus genau einer. */
const contentScriptTargets: Record<string, { readonly entry: string; readonly output: string }> = {
  'content-hook': { entry: 'inject/hook.ts', output: 'inject/hook.js' },
  'content-bridge': { entry: 'content/bridge.ts', output: 'content/bridge.js' },
};

export default defineConfig(({ mode }) => {
  // `envDir` ist das Wurzelverzeichnis des Monorepos: Die Konfiguration steht
  // in der dortigen `.env` (siehe `.env.example`). `envPrefix` begrenzt, was in
  // den Quelltext der Erweiterung gelangt — ohne diese Begrenzung landeten
  // `JWT_SECRET` und `DATABASE_URL` im gebauten Bündel.
  const env = loadEnv(mode, repoRoot, 'SENTENZA_');
  const backendUrl = env.SENTENZA_BACKEND_URL ?? DEFAULT_BACKEND_URL;

  const shared: UserConfig = {
    root: packageDir,
    envDir: repoRoot,
    envPrefix: 'SENTENZA_',
    publicDir: false,
    build: {
      outDir: 'dist',
      // `world: MAIN` setzt Chrome 111 voraus; dasselbe Ziel steht im Manifest.
      target: 'chrome111',
      // Unkomprimiert, damit sich das geladene Bündel im Browser lesen lässt.
      // Die Erweiterung wird nicht über den Web Store ausgeliefert.
      minify: false,
      sourcemap: true,
    },
  };

  const contentScript = contentScriptTargets[mode];
  if (contentScript) {
    return {
      ...shared,
      build: {
        ...shared.build,
        emptyOutDir: false,
        rollupOptions: {
          input: resolve(srcDir, contentScript.entry),
          output: {
            format: 'iife',
            entryFileNames: contentScript.output,
            inlineDynamicImports: true,
          },
        },
      },
    };
  }

  return {
    ...shared,
    plugins: [emitManifest(backendUrl), emitPopupDocument()],
    build: {
      ...shared.build,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          'background/index': resolve(srcDir, 'background/index.ts'),
          'popup/index': resolve(srcDir, 'popup/index.ts'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
});
