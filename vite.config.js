import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const repo = (process.env.GITHUB_REPOSITORY || "").split("/")[1] || "";

export default defineConfig({
  plugins: [react()],
  // Sehr wichtig für GitHub Pages: Basis-URL = /<repo>/
  base: `/${repo}/`,
});
