import type { CapacitorConfig } from "@capacitor/cli";

// Cleartext HTTP / mixed content are dev-only. Local Supabase on the Android
// emulator is http://10.0.2.2:56321 (see .env.example), so a dev sync keeps
// them on; a production build (`NODE_ENV=production npx cap sync`, which is
// what the release pipeline sets) turns both off. Which hosts may use
// cleartext at all is further pinned by
// android/app/src/main/res/xml/network_security_config.xml.
const isDev = process.env.NODE_ENV !== "production" && process.env.CAP_DEV !== "0";

const config: CapacitorConfig = {
  appId: "gy.magistrate.wizard",
  appName: "Magistrate Wizard",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: isDev,
  },
  android: {
    allowMixedContent: isDev,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#141414",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#141414",
    },
  },
};

export default config;
