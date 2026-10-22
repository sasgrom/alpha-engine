import devServer from "@hono/vite-dev-server"
import path from "path"
const __dirname = import.meta.dirname
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
        // Exclude from Hono: everything not under /api/, plus module/asset requests
    // (frontend imports shared code from api/services/*.ts — those URLs DO start
    // with /api/ but carry a file extension, so they must reach Vite, not Hono).
    devServer({ entry: "api/boot.ts", exclude: [/^\/(?!api\/).*$/, /\.[a-z0-9]+(\?.*)?$/i] }),
    inspectAttr(), react()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@contracts": path.resolve(__dirname, "./contracts"),
      "@db": path.resolve(__dirname, "./db"),
      "db": path.resolve(__dirname, "./db"),
    },
  },
  envDir: path.resolve(__dirname),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
  },
});
