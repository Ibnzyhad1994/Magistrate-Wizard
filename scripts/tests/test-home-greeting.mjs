/**
 * Home greets each role by its own title: the administrator is not
 * "Magistrate", and a clerk still waiting for a court is greeted by name.
 *
 *   npm run test:home-greeting
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homeWelcomeTitle } from "@/lib/home-greeting";

assert.equal(
  homeWelcomeTitle({ role: "admin", name: "Local Administrator" }),
  "Welcome, Local Administrator",
  "the admin is greeted by name, not as a magistrate",
);
assert.equal(homeWelcomeTitle({ role: "admin", name: null }), "Welcome");
assert.equal(
  homeWelcomeTitle({ role: "magistrate", name: "Asha Persaud" }),
  "Welcome, Magistrate Asha Persaud",
);
assert.equal(homeWelcomeTitle({ role: "magistrate", name: "  " }), "Welcome, Magistrate");
assert.equal(homeWelcomeTitle({ role: "clerk", name: "Dev Ram" }), "Welcome, Clerk Dev Ram");
assert.equal(homeWelcomeTitle({ role: "clerk", name: null }), "Welcome, Clerk");
assert.equal(
  homeWelcomeTitle({ role: "clerk", name: "Dev Ram", pendingClerk: true }),
  "Welcome, Dev Ram",
);
assert.equal(homeWelcomeTitle({ role: "clerk", name: null, pendingClerk: true }), "Welcome");
assert.equal(homeWelcomeTitle({ role: null, name: "Dev Ram" }), "Welcome, Dev Ram");

const home = readFileSync("src/pages/home-page.tsx", "utf8");
assert.doesNotMatch(home, /`Welcome, Magistrate/, "Home has no hard-coded magistrate greeting");
assert.match(home, /homeWelcomeTitle\(\{ role: profile\.role, name \}\)/, "Home asks by role");

// "Browse docket" and "Judgments" carry their destinations' nav icons, not
// the generic info glyph.
assert.match(home, /label: "Browse docket", href: ROUTES\.docket, icon: ClipboardList/);
assert.match(home, /label: "Judgments", href: ROUTES\.judgments, icon: Scale/);
const nav = readFileSync("src/components/layout/nav-config.ts", "utf8");
assert.match(nav, /label: "Docket",\s+href: ROUTES\.docket,\s+icon: ClipboardList/);
assert.match(nav, /label: "Judgments",\s+href: ROUTES\.judgments,\s+icon: Scale/);

console.log("ALL PASS");
