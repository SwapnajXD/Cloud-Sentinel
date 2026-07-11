module.exports = {
  darkMode: 'class',
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        appBg: "var(--background)",
        appFg: "var(--foreground)",
        cardBg: "var(--card-bg)",
        brandBorder: "var(--border-color)",
        accent: "var(--accent-neon)",
        critical: "var(--color-critical)",
        medium: "var(--color-medium)",
        healthy: "var(--color-healthy)",
        info: "var(--color-info)",
      },
    },
  },
  plugins: [],
};