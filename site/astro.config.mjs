import { defineConfig } from 'astro/config'

export default defineConfig({
  site: 'https://kiliwan.github.io',
  base: '/easyLobby',
  trailingSlash: 'always',
  build: { inlineStylesheets: 'always', format: 'directory' },
  compressHTML: true,
})
