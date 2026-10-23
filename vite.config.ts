import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: { outDir: "dist/web", emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:4090", changeOrigin: false } },
  },
  test: { include: ["test/web/**/*.test.ts"], environment: "node" },
});
