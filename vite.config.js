import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE || "/",
  build: { outDir: "dist" },
  server: {
    sourcemapIgnoreList: (sourcePath) => sourcePath.includes("node_modules"),
  },
  define: {
    __BUILD_DATE__: JSON.stringify(
      process.env.VITE_BUILD_DATE || new Date().toISOString()
    ),
  },
});
