import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Cache the runtime and Markdown dependencies independently of app changes.
        manualChunks: {
          "react-vendor": ["react", "react-dom/client", "react/jsx-runtime"],
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
});
