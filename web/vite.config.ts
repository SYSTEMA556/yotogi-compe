import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: { outDir: "../server/dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8080" } },
});
