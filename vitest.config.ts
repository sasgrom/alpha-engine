import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      // @db is needed by the api tests (services/*.test.ts import the schema via the alias)
      "@db": path.resolve(templateRoot, "db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    // environment: "node" by default; React component tests are marked with
    // the `// @vitest-environment jsdom` pragma on the first line of the file
    environment: "node",
    include: ["api/**/*.test.ts", "api/**/*.spec.ts", "src/**/*.test.tsx", "worker/**/*.test.ts"],
  },
});
