import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import checker from 'vite-plugin-checker';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // By default, vite doesn't output typescript errors.
    // This plugin causes errors to be printed to stdout/stderr, meaning they
    // can be picked up by the problem matcher defined in .vscode/tasks.json.
    // https://github.com/vitejs/vite/issues/4393#issuecomment-890996317
    checker({typescript: true})
  ],
  server: {
    port: 3002
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main.tsx')
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`,
      }
    }
  }
})
