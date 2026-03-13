import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  noExternal: [],
  external: ["express"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
