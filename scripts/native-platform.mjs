import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] === "ios" ? "ios" : "android";

const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", shell: true });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
  });

await run("npm", ["run", "build"]);
await run("node", ["scripts/native-sync-version.mjs"]);

if (!existsSync(join(root, target))) {
  if (target === "ios" && platform() !== "darwin") {
    console.error(
      "The iOS project is not in this repo yet. On a Mac run: npx cap add ios && npx cap sync ios",
    );
    process.exit(1);
  }
  await run("npx", ["cap", "add", target]);
}

await run("npx", ["cap", "sync", target]);
console.log(`Synced ${target}. Open with: npx cap open ${target}`);
