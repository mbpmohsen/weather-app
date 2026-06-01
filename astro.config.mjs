import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";

export default defineConfig({
  integrations: [preact()],
  output: "static",
  vite: {
    build: {
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("uplot")) return "charts";
          }
        }
      }
    }
  }
});
