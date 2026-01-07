import { defineConfig } from 'vite'

export default defineConfig({
  base: '/game/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
})
