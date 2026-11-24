import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: { outDir: "../server/dist", emptyOutDir: true },
  server: { proxy: { "/api": "http://localhost:8080" } },
});
