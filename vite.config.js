import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // WICHTIG: Repo-Name als Base für GitHub Pages
  base: "/reisekosten/",
});
