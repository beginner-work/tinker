/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/renderer/index.html", "./src/renderer/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        display: [
          "Plus Jakarta Sans",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        background: "#FFFDF7",
        foreground: "#2D2A26",
        muted: "#6F6A65",
        card: "#FFF9F0",
        border: "#EDE8E0",
        cream: "#F5F3EF",
        parchment: "#F7F0E3",
        forest: "#2D5A3D",
        leaf: "#7BC47A",
        accent: {
          DEFAULT: "#6366F1",
          soft: "#A5B4FC",
          dim: "#EEF2FF",
        },
      },
      boxShadow: {
        soft: "0 1px 2px rgba(45, 90, 61, 0.05), 0 4px 16px rgba(45, 90, 61, 0.06)",
        accent: "0 1px 2px rgba(99, 102, 241, 0.18), 0 6px 18px rgba(99, 102, 241, 0.22)",
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 350ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
      },
    },
  },
  plugins: [],
};
