import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { initNativeShell } from "@/lib/native-shell";
import { initSentry } from "@/lib/sentry";
// Self-hosted fonts (the weights index.html used to request from Google
// Fonts). Imported before index.css so the @font-face rules precede the
// theme's font-family declarations; Vite emits the woff2 files as
// same-origin assets, which is what lets the CSP drop the Google origins.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/cinzel/500.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@/index.css";

initSentry();
void initNativeShell();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found. Check index.html.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
