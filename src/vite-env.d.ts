/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID_WEB?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID_DESKTOP?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID_ANDROID?: string;
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID_IOS?: string;
  readonly VITE_GOOGLE_OAUTH_REDIRECT_URI?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
