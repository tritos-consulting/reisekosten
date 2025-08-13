// vite.config.mjs
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dein Repo ist tritos-consulting/reisekosten → base MUSS so sein:
export default defineConfig({
  plugins: [react()],
  base: "/reisekosten/",
});
