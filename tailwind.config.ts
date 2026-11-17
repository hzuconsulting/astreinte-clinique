import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#14213D',
        muted: '#5C6B84',
        line: '#E3E8F0',
        paper: '#F6F8FB',
        teal: { DEFAULT: '#0F766E', dark: '#115E59', light: '#E0F2F1' },
        rose: { DEFAULT: '#E11D48', light: '#FFE4EA' },
        amber: { DEFAULT: '#B45309', light: '#FEF3C7' },
      },
      boxShadow: { card: '0 1px 2px rgba(20,33,61,.06), 0 4px 16px rgba(20,33,61,.06)' },
    },
  },
  plugins: [],
};
export default config;
