/**
 * Single source of truth for the human version (`package.json`) and the
 * monotonic native build number (`native/version.json` versionCode).
 * Vite injects both at build time via `define`.
 */
export const APP_VERSION: string = __APP_VERSION__;
export const APP_BUILD: string = __APP_BUILD__;
