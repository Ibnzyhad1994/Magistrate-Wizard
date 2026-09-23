import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

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
        // Surface scale (index.css). 1 = raised card, 2 = nested / hover,
        // 3 = pressed or the top of a stack. Prefer these over borders to
        // separate a region from the canvas; `hairline` is the one-pixel
        // crease a raised surface may draw.
        surface: {
          1: "hsl(var(--surface-1))",
          2: "hsl(var(--surface-2))",
          3: "hsl(var(--surface-3))",
        },
        hairline: "hsl(var(--hairline))",
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
      // Reading measure for long legal text (judgments, case law): 65-75
      // characters per line at body size. Inter's `ch` (the width of "0")
      // is wider than its average letter, so 56ch reads as about 70.
      maxWidth: {
        measure: "56ch",
      },
      // Elevation is a per-palette shadow string (none in high contrast,
      // where edges are drawn by --border instead).
      boxShadow: {
        "elevation-1": "var(--elevation-1)",
        "elevation-2": "var(--elevation-2)",
        "elevation-3": "var(--elevation-3)",
      },
      // Display scale. Titles are set tight (Netflix Sans-style
      // -0.02em) so a 60px heading reads as one shape; body text keeps
      // normal tracking. Weights: 800 display, 700 title, 600 heading.
      fontSize: {
        "display-xl": [
          "clamp(2.5rem, 1.5rem + 3.5vw, 4rem)",
          { lineHeight: "1", letterSpacing: "-0.02em", fontWeight: "800" },
        ],
        display: [
          "clamp(2rem, 1.4rem + 2vw, 2.75rem)",
          { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "800" },
        ],
        "title-lg": ["1.5rem", { lineHeight: "1.2", letterSpacing: "-0.015em", fontWeight: "700" }],
        title: ["1.125rem", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "700" }],
        heading: ["1rem", { lineHeight: "1.4", letterSpacing: "-0.005em", fontWeight: "600" }],
      },
      transitionTimingFunction: {
        // Fast start, long settle — the ease every hover, sheet and page
        // change shares so motion feels like one system.
        "out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        250: "250ms",
        400: "400ms",
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
        // Route change: content rises 6px and fades in. Short enough to
        // read as a cut, not a slide.
        "page-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        // Skeleton sheen sweeping left to right (background-position on a
        // 200%-wide gradient, see Skeleton).
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "spin-slow": "spin-slow 1.2s linear infinite",
        "card-in": "card-in 0.2s ease-out",
        "page-in": "page-in 0.4s cubic-bezier(0.22, 1, 0.36, 1) both",
        "fade-in": "fade-in 0.25s ease-out both",
        shimmer: "shimmer 1.8s linear infinite",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        brand: ["Cinzel", "Palatino Linotype", "Palatino", "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [
    animate,
    // `hc:` — only when the high-contrast palette is active (either
    // scheme). Used to put a real border back on surfaces that otherwise
    // rely on luminance and shadow to stand off the canvas.
    plugin(({ addVariant }) => {
      addVariant("hc", ".theme-high-contrast &");
    }),
  ],
};

export default config;
