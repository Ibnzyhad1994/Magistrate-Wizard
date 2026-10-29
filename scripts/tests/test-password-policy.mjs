/**
 * BE-25: the password policy the forms check (src/lib/auth/password-policy.ts)
 * is the one Supabase Auth enforces (supabase/config.toml). A form that
 * accepts a password the server refuses shows a raw "weak password" error
 * after submit; a form stricter than the server is just wrong. This reads
 * config.toml as text and fails when the two drift apart, and pins the
 * rest of the BE-25 auth hardening in the same file.
 *
 *   npm run test:password-policy
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULES,
  PASSWORD_SYMBOLS,
} from "../../src/lib/auth/password-policy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = readFileSync(join(__dirname, "../../supabase/config.toml"), "utf8");

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} - ${label}`);
  if (!pass) {
    console.log("  expected:", JSON.stringify(expected));
    console.log("  actual:  ", JSON.stringify(actual));
    failures += 1;
  }
}

/** The value of `key = ...` inside `[section]` (top-level keys of that table only). */
function tomlValue(section, key) {
  let current = null;
  for (const raw of config.split("\n")) {
    const line = raw.trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    if (current !== section) continue;
    const match = new RegExp(`^${key}\\s*=\\s*(.+)$`).exec(line);
    if (match) return match[1].replace(/\s+#.*$/, "").replace(/^"(.*)"$/, "$1");
  }
  return null;
}

// --- config.toml -----------------------------------------------------------

check(
  "config.toml minimum_password_length matches PASSWORD_MIN_LENGTH",
  Number(tomlValue("auth", "minimum_password_length")),
  PASSWORD_MIN_LENGTH,
);
check("the minimum is at least 12 (BE-25)", PASSWORD_MIN_LENGTH >= 12, true);
check(
  "config.toml requires lower, upper, digits and symbols",
  tomlValue("auth", "password_requirements"),
  "lower_upper_letters_digits_symbols",
);
check(
  "config.toml secure_password_change is on",
  tomlValue("auth.email", "secure_password_change"),
  "true",
);
check("config.toml TOTP enrolment is on", tomlValue("auth.mfa.totp", "enroll_enabled"), "true");
check("config.toml TOTP verification is on", tomlValue("auth.mfa.totp", "verify_enabled"), "true");

// --- the symbol set --------------------------------------------------------
// The Supabase CLI maps lower_upper_letters_digits_symbols to this GoTrue
// GOTRUE_PASSWORD_REQUIRED_CHARACTERS value (pkg/api types.gen.go); the
// last `:`-separated part, with its escaped colon, is the symbol set.

const GOTRUE_REQUIRED =
  "abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};'\\\\:\"|<>?,./`~";
const gotrueSymbols = GOTRUE_REQUIRED.split(/(?<!\\):/)
  .at(-1)
  .replace(/\\:/g, ":");
check("PASSWORD_SYMBOLS is GoTrue's symbol set", PASSWORD_SYMBOLS, gotrueSymbols);

// --- the rules -------------------------------------------------------------

const failing = (password) =>
  PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.message);

check("a 14-character password with every class passes", failing("Good-Pass-2026"), []);
check(
  "every GoTrue symbol counts as a symbol",
  [...PASSWORD_SYMBOLS].filter((s) => failing(`GoodPass2026${s}`).length !== 0),
  [],
);
check("a space is not a symbol", failing("GoodPass 2026"), [
  "Password must contain a symbol, such as ! ? # or -",
]);
check("a short, simple password fails every rule it breaks", failing("password"), [
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  "Password must contain an uppercase letter",
  "Password must contain a number",
  "Password must contain a symbol, such as ! ? # or -",
]);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
