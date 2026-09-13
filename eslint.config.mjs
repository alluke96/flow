import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Saída do build do app de TV: é código gerado (o export estático do
    // próprio Flow), não fonte — ver scripts/build-tizen.mjs.
    ".next-tizen/**",
    "tizen/app/**",
  ]),
]);

export default eslintConfig;
