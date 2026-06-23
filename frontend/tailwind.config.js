/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'sishome-bg': '#F3F4F6',
        'sishome-primary': '#1E3A8A', 
        'sishome-accent': '#10B981', 
        'sishome-danger': '#EF4444', 
      }
    },
  },
  plugins: [],
}