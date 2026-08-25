import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "gy.magistrate.wizard",
  appName: "Magistrate Wizard",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // Local Supabase on the Android emulator is http://10.0.2.2:55321.
    // Keep cleartext enabled so that emulator/dev builds can reach it.
    // Hosted production must use HTTPS VITE_SUPABASE_URL.
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
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
