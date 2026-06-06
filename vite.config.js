import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel serves from the domain root, so base must be '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
})
