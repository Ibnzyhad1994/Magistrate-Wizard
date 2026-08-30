import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { googleOAuthTokenProxyPlugin } from "./scripts/google-oauth-token-proxy.mjs";
import { buildCsp } from "./scripts/content-security-policy";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};
const native = JSON.parse(
  readFileSync(path.resolve(__dirname, "native/version.json"), "utf8"),
) as { versionCode: number };

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || "http://127.0.0.1:55321";
  const csp = buildCsp(supabaseUrl);
  const productionHeaders = { "Content-Security-Policy": csp };

  return {
    plugins: [
      react(),
      googleOAuthTokenProxyPlugin(env),
      {
        name: "csp-html",
        transformIndexHtml(html: string) {
          if (mode === "development") return html;
          return html.replace(
            "<head>",
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, "&quot;")}" />`,
          );
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __APP_BUILD__: JSON.stringify(String(native.versionCode)),
    },
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
      headers: productionHeaders,
    },
    optimizeDeps: {
      include: ["pdfjs-dist", "tesseract.js"],
    },
    worker: {
      format: "es",
    },
  };
});
