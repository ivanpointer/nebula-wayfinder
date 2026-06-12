import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  // neo4j-driver uses Node built-ins; tell Vite to treat it as external
  // in the browser bundle and rely on the npm shims it ships.
  optimizeDeps: {
    include: ["neo4j-driver"],
  },
});
