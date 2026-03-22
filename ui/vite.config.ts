import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: ".",
  base: "/ui/",
  resolve: {
    alias: {
      "@zts/api-client": resolve(__dirname, "src/api-client.ts"),
      "@zts/bundle": resolve(__dirname, "src/bundle.ts"),
    },
  },
  build: {
    outDir: "dist",
    emptyDirFirst: true,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      input: {
        app: resolve(__dirname, "app.html"),
        login: resolve(__dirname, "login.html"),
      },
      output: {
        chunkFileNames: (chunkInfo) => {
          const name = chunkInfo.name?.replace(/\.ts$/, "") ?? "chunk";
          return `assets/${name}-[hash].js`;
        },
      },
    },
  },
  server: {
    proxy: {
      "/a": "http://localhost:8000",
      "/recent": "http://localhost:8000",
      "/info": "http://localhost:8000",
      "/search": "http://localhost:8000",
      "/similar": "http://localhost:8000",
      "/relationships": "http://localhost:8000",
      "/properties": "http://localhost:8000",
      "/test-evaluation": "http://localhost:8000",
      "/test-runs": "http://localhost:8000",
      "/goals": "http://localhost:8000",
      "/prompts": "http://localhost:8000",
      "/status": "http://localhost:8000",
      "/log": "http://localhost:8000",
      "/bundle": "http://localhost:8000",
      "/ui/login": "http://localhost:8000",
      "/ui/logout": "http://localhost:8000",
      "/ui/me": "http://localhost:8000",
    },
  },
});
