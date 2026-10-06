import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

const viteCacheJeOutDir = {
  name: "vite-cache-je-outdir",
  hooks: {
    "astro:config:setup": ({ config, updateConfig }) => {
      const ziel = basename(fileURLToPath(config.outDir));
      const cacheDir = new URL(`./node_modules/.vite-${ziel}/`, config.root);
      updateConfig({ vite: { cacheDir: fileURLToPath(cacheDir) } });
    },
  },
};

export default defineConfig({
  site: "https://sundartha.com",
  output: "static",
  integrations: [viteCacheJeOutDir],
  build: {
    inlineStylesheets: "never",
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
