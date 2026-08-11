import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    host: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020",
  },
});
