import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "shared"),
      "@": path.resolve(__dirname, "client/src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 30000,
    sequence: { shuffle: false },
    include: ["tests/**/*.test.ts"],
  },
});
