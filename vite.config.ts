import { readFileSync } from "node:fs";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { visualizer } from "rollup-plugin-visualizer";
import { googleOAuthTokenProxyPlugin } from "./scripts/google-oauth-token-proxy.mjs";
import { buildCsp, cspWithInlineScriptHashes } from "./scripts/content-security-policy";

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8")) as {
  version: string;
};
const native = JSON.parse(readFileSync(path.resolve(__dirname, "native/version.json"), "utf8")) as {
  versionCode: number;
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const supabaseUrl = env.VITE_SUPABASE_URL || "http://127.0.0.1:56321";
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
          // Allows index.html's inline theme bootstrap by hash rather than
          // widening script-src with 'unsafe-inline'. See the helper's own
          // comment for why the hash is derived, not written down.
          const withHashes = cspWithInlineScriptHashes(csp, html);
          return html.replace(
            "<head>",
            `<head>\n    <meta http-equiv="Content-Security-Policy" content="${withHashes.replace(/"/g, "&quot;")}" />`,
          );
        },
      },
      // `ANALYZE=1 npx vite build` writes an interactive treemap of every
      // chunk to dist/stats.html. Off by default so an ordinary build emits
      // nothing extra.
      ...(env.ANALYZE === "1"
        ? [
            visualizer({
              filename: "dist/stats.html",
              gzipSize: true,
              brotliSize: true,
              open: false,
            }),
          ]
        : []),
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
    build: {
      // Size budget. Route chunks are tens of kB; the vendor chunks below
      // and pdf.js (lazy, ~530 kB) are the only ones expected near this
      // line. A new chunk crossing it should be split, not waved through
      // by raising the number.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // Stable vendor chunks so a change to one page does not
          // invalidate React or Supabase in every client's cache, and so
          // TipTap/ProseMirror only load with the editor.
          manualChunks(id: string) {
            if (!id.includes("node_modules")) return undefined;
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            ) {
              return "vendor-react";
            }
            if (/[\\/]node_modules[\\/]@supabase[\\/]/.test(id)) return "vendor-supabase";
            if (/[\\/]node_modules[\\/](@tiptap[\\/]|prosemirror-)/.test(id))
              return "vendor-editor";
            if (/[\\/]node_modules[\\/]@radix-ui[\\/]/.test(id)) return "vendor-radix";
            if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "vendor-icons";
            return undefined;
          },
        },
      },
    },
  };
});
