import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Reuse the app transform pipeline. Archived worktrees and source snapshots
// are never test roots, including when a single file is passed on the CLI.
export default defineConfig(async environment => mergeConfig(
  await (typeof viteConfig === "function" ? viteConfig(environment) : viteConfig),
  { test: { exclude: [...configDefaults.exclude, "**/.local/**", "**/.contracts-source/**", "**/.agent-host-source/**", "**/.skills-source/**"] } },
));
