import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Frontend dev server proxies API calls to the Express backend (server/index.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
