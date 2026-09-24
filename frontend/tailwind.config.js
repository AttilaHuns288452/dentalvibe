export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Brand — D.A.R. Dental teal, matches the Figma frames (SF Dental.pdf)
        primary: {
          50: '#e6f4f3',   // accent-soft
          100: '#ccfbf1',
          200: '#99e2d8',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',  // accent
          700: '#0f766e',  // accent-dark
          800: '#115e59',
          900: '#134e4a',
        },
      },
    },
  },
  plugins: [],
}
