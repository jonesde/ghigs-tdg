import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig, type ConfigEnv } from "vite";

// Project Pages lives at /<repo>/. CI passes PAGES_BASE_PATH from configure-pages
// ("" is a user site or custom domain, served at /). Dev stays at / so local work
// is not under the repo path. Preview keeps the build base: asset URLs are already
// written into dist/index.html.
export function resolvePagesBase(configEnv: Pick<ConfigEnv, "command" | "isPreview">): string {
  if (configEnv.command === "serve" && !configEnv.isPreview) return "/";
  const configuredBasePath = process.env.PAGES_BASE_PATH;
  if (configuredBasePath === undefined) return "/ghigs-tdg/";
  if (configuredBasePath === "" || configuredBasePath === "/") return "/";
  return configuredBasePath.endsWith("/") ? configuredBasePath : `${configuredBasePath}/`;
}

export default defineConfig((configEnv) => ({
  base: resolvePagesBase(configEnv),
  plugins: [vue()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  worker: { format: "es" },
  server: { port: 3000 },
}));
