import { defineConfig, type Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { selectPrecacheUrls } from './src/pwa/precacheManifest'

const DIST_DIR = 'dist'
const SW_TEMPLATE_PATH = 'tools/sw-template.js'
const SW_KILL_TEMPLATE_PATH = 'tools/sw-kill-template.js'
const SW_OUTPUT_PATH = join(DIST_DIR, 'sw.js')

function listFilesRecursively(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...listFilesRecursively(fullPath))
    else found.push(fullPath)
  }
  return found
}

function toRootRelativeUrl(filePath: string): string {
  return '/' + relative(DIST_DIR, filePath).split(sep).join('/')
}

/**
 * Generates dist/sw.js once the bundle and the public/ copy are both on disk —
 * the precache list has to name Vite's content-hashed filenames, so it can only
 * be built from the finished dist tree. closeBundle is the hook that sees it.
 */
function serviceWorkerPlugin(): Plugin {
  return {
    name: 'pwa-service-worker',
    apply: 'build',
    closeBundle() {
      if (process.env.PWA_KILL === '1') {
        writeFileSync(SW_OUTPUT_PATH, readFileSync(SW_KILL_TEMPLATE_PATH, 'utf8'))
        this.warn('PWA_KILL=1 — emitted the self-destruct service worker')
        return
      }

      const precacheUrls = selectPrecacheUrls(
        listFilesRecursively(DIST_DIR).map(toRootRelativeUrl)
      )

      // Any change to a precached byte has to produce a new cache name, or
      // clients keep serving the old shell forever.
      const buildHash = createHash('sha256')
      for (const url of precacheUrls) {
        buildHash.update(url)
        buildHash.update(readFileSync(join(DIST_DIR, url.slice(1))))
      }

      const serviceWorker = readFileSync(SW_TEMPLATE_PATH, 'utf8')
        .replaceAll('__BUILD_ID__', buildHash.digest('hex').slice(0, 12))
        .replaceAll('__PRECACHE_URLS__', JSON.stringify(precacheUrls))

      writeFileSync(SW_OUTPUT_PATH, serviceWorker)
      console.log(`pwa: precached ${precacheUrls.length} files`)
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [serviceWorkerPlugin()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    target: 'esnext',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
})
