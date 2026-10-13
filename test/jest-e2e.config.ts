import type { Config } from "jest";

const config: Config = {
  rootDir: "..",
  moduleFileExtensions: ["js", "json", "ts"],
  testRegex: "test/.*\\.e2e-spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testEnvironment: "node",
  globalSetup: "<rootDir>/test/global-setup.ts",
  setupFiles: ["<rootDir>/test/env.ts"],
  testTimeout: 30_000,
  maxWorkers: 1,
};

export default config;
