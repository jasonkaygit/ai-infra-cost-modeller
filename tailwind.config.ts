import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Control-room / ledger palette
        ground: "#0B0F14", // deep slate
        panel: "#121821",
        panel2: "#0F141B",
        line: "#1E2833",
        ink: "#E6EDF3",
        muted: "#8A97A6",
        faint: "#5B6673",
        signal: "#38E1B0", // oscilloscope teal — the single accent
        signalDim: "#1C8B6E",
        amber: "#E9B949", // stepped / attention
        coral: "#E06C75", // cost / negative
        violet: "#8B7CF6", // human escalation
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      borderRadius: { xl: "10px", "2xl": "14px" },
      fontSize: {
        "figure-xl": ["2.75rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
        "figure-lg": ["1.75rem", { lineHeight: "1.05", letterSpacing: "-0.01em" }],
      },
    },
  },
  plugins: [],
};
export default config;
