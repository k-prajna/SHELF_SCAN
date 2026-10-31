/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        forest: '#28634C',
        emerald: '#397B5C',
        sage: '#B8D8C5',
        mint: '#DDECE2',
        background: '#F1F6F1',
      },
      boxShadow: {
        glass: '0 20px 50px rgba(32,53,43,0.08)',
      },
    },
  },
  plugins: [],
}
