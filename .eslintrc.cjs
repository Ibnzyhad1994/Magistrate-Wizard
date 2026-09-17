const fs = require("fs");
const path = require("path");

// Feature folders under src/pages. A page may import from its own folder
// (sub-components, dialogs, panels) but never from another feature folder.
// Anything two features need belongs in src/components, src/hooks or src/lib.
const pageEntries = fs.readdirSync(path.join(__dirname, "src/pages"), { withFileTypes: true });
const pageDirs = pageEntries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const standalonePages = pageEntries
  .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
  .map((entry) => entry.name.replace(/\.tsx?$/, ""));

// Everything under src/pages except `ownDir`. Each other folder is excluded
// by `<folder>/**` rather than a blanket `@/pages/**` because gitignore
// semantics (which no-restricted-imports uses) cannot re-include a file
// once its parent directory is excluded — and we need to re-include the
// grandfathered imports below.
const otherPagePatterns = (ownDir) => [
  ...pageDirs.filter((dir) => dir !== ownDir).map((dir) => `@/pages/${dir}/**`),
  ...standalonePages.map((page) => `@/pages/${page}`),
];

// Pre-existing cross-feature page imports, grandfathered so the rule can land
// green. Each is debt: move the component into src/components/<feature>/ and
// delete its line here. Do not add to this list.
const KNOWN_CROSS_FEATURE_IMPORTS = {
  legislation: [
    "@/pages/admin/legislation-pdf-upload-panel",
    "@/pages/bench-notes/create-bench-note-dialog",
  ],
};

// Type-only imports are allowed across layers: they vanish at build time and
// cannot create a runtime dependency cycle.
const restrictImports = (group, message) => ({
  "@typescript-eslint/no-restricted-imports": [
    "error",
    { patterns: [{ group, message, allowTypeImports: true }] },
  ],
});

module.exports = {
  root: true,
  env: { browser: true, es2021: true, node: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
  ],
  ignorePatterns: [
    "dist",
    "release",
    "android",
    "ios",
    "playwright-report",
    "test-results",
    ".eslintrc.cjs",
  ],
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["react-refresh", "jsx-a11y"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      { prefer: "type-imports" },
    ],
    // A <label> wrapping one of our form primitives is programmatically
    // associated (the primitive renders the native control); the rule only
    // knows about raw <input>/<select>/<textarea> unless told otherwise.
    "jsx-a11y/label-has-associated-control": [
      "error",
      {
        controlComponents: ["Input", "Select", "Textarea", "Checkbox", "DateOnlyInput", "PasswordInput", "TagInput"],
        depth: 3,
      },
    ],
  },
  overrides: [
    // Layering: src/lib is framework-free domain logic and must stay importable
    // from plain Node (scripts/tests run it directly). No React layer below it.
    {
      files: ["src/lib/**/*.{ts,tsx}"],
      rules: restrictImports(
        [
          "@/components",
          "@/components/**",
          "@/hooks",
          "@/hooks/**",
          "@/pages",
          "@/pages/**",
          "@/providers",
          "@/providers/**",
          "@/layouts",
          "@/layouts/**",
        ],
        "src/lib must not depend on React layers (components/hooks/pages/providers/layouts). Move the shared piece into src/lib or pass it in as an argument.",
      ),
    },
    // Layering: standalone pages (src/pages/*.tsx) import no other page.
    {
      files: ["src/pages/*.{ts,tsx}"],
      rules: restrictImports(
        otherPagePatterns(null),
        "Pages must not import other pages. Shared UI belongs in src/components; shared logic in src/hooks or src/lib.",
      ),
    },
    // Layering: a feature folder may import its own files, never another feature folder.
    ...pageDirs.map((dir) => ({
      files: [`src/pages/${dir}/**/*.{ts,tsx}`],
      rules: restrictImports(
        [
          ...otherPagePatterns(dir),
          ...(KNOWN_CROSS_FEATURE_IMPORTS[dir] ?? []).map((spec) => `!${spec}`),
        ],
        `src/pages/${dir} may only import pages from its own folder. Shared UI belongs in src/components; shared logic in src/hooks or src/lib.`,
      ),
    })),
    // Node-side TypeScript: build config and Playwright specs.
    {
      files: [
        "vite.config.ts",
        "playwright.config.ts",
        "capacitor.config.ts",
        "scripts/**/*.ts",
        "e2e/**/*.ts",
      ],
      env: { node: true, browser: false },
      rules: {
        "react-refresh/only-export-components": "off",
      },
    },
  ],
  settings: {
    react: { version: "detect" },
  },
};
