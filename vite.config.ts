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
    port: 5373,
    strictPort: true,
    host: true,
    allowedHosts: [".trycloudflare.com"],
  },
  preview: {
    port: 4173,
  },
  optimizeDeps: {
    include: ["pdfjs-dist", "tesseract.js"],
  },
  worker: {
    format: "es",
  },
});
