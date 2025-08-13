// vite.config.mjs
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dein Repo heißt tritos-consulting/reisekosten → base exakt so:
export default defineConfig({
  plugins: [react()],
  base: "/reisekosten/",
});
