import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@/App";
import { initNativeShell } from "@/lib/native-shell";
import "@/index.css";

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
