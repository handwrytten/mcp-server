import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: false,
  sourcemap: true,
  target: "node20",
  noExternal: [],
  external: ["express"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
