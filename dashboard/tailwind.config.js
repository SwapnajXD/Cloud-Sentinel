module.exports = {
  darkMode: 'class',
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        abyss: "var(--abyss)",
        panel: "var(--panel)",
        panel2: "var(--panel-2)",
        grid: "var(--grid)",
        mist: "var(--mist)",
        haze: "var(--haze)",
        signal: "var(--signal)",
        critical: "var(--critical)",
        medium: "var(--medium)",
        low: "var(--low)",
        good: "var(--good)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        xl2: "1rem",
      },
    },
  },
  plugins: [],
};
