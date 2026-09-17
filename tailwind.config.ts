import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Body links. Separate from `primary` because the dark palettes'
        // brand red is a 3.9:1 button fill, not a 4.5:1 text colour.
        link: "hsl(var(--link))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        brass: {
          DEFAULT: "hsl(var(--brass))",
          foreground: "hsl(var(--brass-foreground))",
        },
        match: {
          DEFAULT: "hsl(var(--match))",
        },
        // Domain status tokens (defined per palette in index.css). Registered
        // here so call sites write `bg-notice-action`, not
        // `bg-[hsl(var(--notice-action))]`, and opacity modifiers work.
        stage: {
          progress: "hsl(var(--stage-progress))",
          done: "hsl(var(--stage-done))",
          remand: "hsl(var(--stage-remand))",
          dismissed: "hsl(var(--stage-dismissed))",
          "outcome-complete": "hsl(var(--stage-outcome-complete))",
        },
        notice: {
          action: "hsl(var(--notice-action))",
          granted: "hsl(var(--notice-granted))",
          revoked: "hsl(var(--notice-revoked))",
          outcome: "hsl(var(--notice-outcome))",
        },
        capacity: {
          available: "hsl(var(--capacity-available))",
          filling: "hsl(var(--capacity-filling))",
          full: "hsl(var(--capacity-full))",
          over: "hsl(var(--capacity-over))",
        },
        // Semantic aliases so generic UI (alerts, toasts) never hardcodes
        // amber/green and stays in step with the colourblind and
        // high-contrast palettes.
        warning: "hsl(var(--notice-action))",
        success: "hsl(var(--notice-granted))",
        info: "hsl(var(--notice-outcome))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      // Explicit scale: sm 2px / md 4px / lg 6px with --radius: 0.25rem.
      // `rounded` (Tailwind's default 0.25rem) equals `rounded-md`; prefer
      // `rounded-md` so the scale reads in one direction.
      borderRadius: {
        lg: "calc(var(--radius) + 2px)",
        md: "var(--radius)",
        sm: "calc(var(--radius) - 2px)",
      },
      // Named stacking tiers. Use these instead of `z-[NN]` so the order is
      // decided once: page chrome < modal < floating menus < hints < skip
      // link < walkthrough < session lock.
      zIndex: {
        nav: "50",
        dialog: "60",
        popover: "70",
        hint: "80",
        skip: "100",
        tour: "200",
        lock: "220",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        "card-in": {
          from: { opacity: "0", transform: "translateY(8px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "spin-slow": "spin-slow 1.2s linear infinite",
        "card-in": "card-in 0.2s ease-out",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        brand: ["Cinzel", "Palatino Linotype", "Palatino", "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [animate],
};

export default config;
