import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tsc emits test copies without fixtures; run the source tests exactly once.
    exclude: [...configDefaults.exclude, "dist/**"],
  },
});
