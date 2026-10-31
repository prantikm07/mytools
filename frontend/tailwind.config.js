/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#0a0a0a', 900: '#121212', 850: '#18181b', 800: '#1f1f23', 700: '#2a2a2e' },
        lime: { accent: '#a3e635', deep: '#84cc16' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
