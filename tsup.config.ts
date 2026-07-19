import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "next/index": "src/next/index.ts",
    "react/index": "src/react/index.ts",
  },
  format: ["esm"],
  dts: true,
  // Omit sourcemaps from the published bundle (smaller + less supply-chain noise).
  sourcemap: false,
  clean: true,
  external: ["react", "react-dom", "next", "next/server"],
  treeshake: true,
  splitting: false,
});
