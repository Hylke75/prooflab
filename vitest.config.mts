import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.dirname(fileURLToPath(import.meta.url)),
      // Server modules are imported directly in tests; the "server-only" guard is for bundles.
      "server-only": path.join(path.dirname(fileURLToPath(import.meta.url)), "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts", "tests/eval/**/*.test.ts"],
    environment: "node",
  },
});
