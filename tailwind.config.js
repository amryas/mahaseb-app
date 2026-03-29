/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
      colors: {
        saas: {
          shell: '#0B0F19',
          card: '#111827',
          primary: '#00C896',
          'primary-hover': '#00b383',
        },
      },
      boxShadow: {
        soft: '0 4px 24px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.04)',
        'saas-card': '0 4px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
};

