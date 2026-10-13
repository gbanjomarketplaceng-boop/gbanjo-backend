import type { Config } from "jest";

// Unit tests: src/**/*.spec.ts. E2E tests live in test/ (see test/jest-e2e.config.ts).
const config: Config = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testEnvironment: "node",
};

export default config;
