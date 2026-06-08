import { defineConfig } from "tsup";
import { readFileSync, writeFileSync } from "node:fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  splitting: false,
  sourcemap: true,
  dts: false,
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    const f = "dist/index.js";
    writeFileSync(f, readFileSync(f, "utf8").replace(/from "sqlite"/g, 'from "node:sqlite"'));
  },
});
