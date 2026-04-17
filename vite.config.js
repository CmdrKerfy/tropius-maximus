import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || "/",
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-duckdb": ["@duckdb/duckdb-wasm"],
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes("node_modules"),
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
  define: {
    __BUILD_DATE__: JSON.stringify(
      process.env.VITE_BUILD_DATE || new Date().toISOString()
    ),
    __BUILD_ID__: JSON.stringify(
      process.env.VITE_BUILD_ID || `${Date.now()}`
    ),
  },
});
