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
    // with REAL file extensions (frontend imports shared code from
    // api/services/*.ts). NB: tRPC procedure names contain dots
    // (/api/trpc/auth.login) — a generic /\.\w+$/ would eat them.
    devServer({
      entry: "api/boot.ts",
      exclude: [/^\/(?!api\/).*$/, /\.(ts|tsx|js|jsx|mjs|cjs|css|map|json|png|jpe?g|gif|svg|ico|webp|woff2?|ttf)(\?.*)?$/i],
    }),
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
