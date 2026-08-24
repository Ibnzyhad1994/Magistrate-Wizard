import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const waitForVite = async () => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("http://127.0.0.1:5373");
      if (res.ok || res.status === 404) return;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error("Vite did not start on http://127.0.0.1:5373");
};

const vite = spawn("npm", ["run", "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

await waitForVite();

const electron = spawn("npx", ["electron", "."], {
  cwd: root,
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ELECTRON_DEV: "1" },
});

const shutdown = () => {
  vite.kill();
  electron.kill();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

electron.on("exit", (code) => {
  vite.kill();
  process.exit(code ?? 0);
});
