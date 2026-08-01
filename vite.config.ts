import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const mediapipeStaticAssets = (): Plugin => ({
  name: 'doctorar-mediapipe-static-assets',
  configureServer(server) {
    const assetRoot = resolve(process.cwd(), 'public', 'mediapipe', 'wasm')
    const assetPrefix = `${assetRoot}${sep}`
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split('?', 1)[0] ?? ''
      const urlPrefix = '/mediapipe/wasm/'
      if (!pathname.startsWith(urlPrefix)) {
        next()
        return
      }

      const fileName = decodeURIComponent(pathname.slice(urlPrefix.length))
      const assetPath = resolve(assetRoot, fileName)
      if (!assetPath.startsWith(assetPrefix) || !existsSync(assetPath)) {
        next()
        return
      }

      response.statusCode = 200
      response.setHeader('Content-Type', assetPath.endsWith('.wasm') ? 'application/wasm' : 'text/javascript; charset=utf-8')
      response.setHeader('Cache-Control', 'no-cache')
      createReadStream(assetPath).pipe(response)
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [mediapipeStaticAssets(), react()],
})
