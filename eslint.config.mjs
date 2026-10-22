import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Derive state in render, act in event handlers. A genuine external-system sync
      // gets an eslint-disable line that says why.
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='useEffect'], CallExpression[callee.property.name='useEffect']",
          message: "Avoid useEffect: derive during render, use event handlers, or useSyncExternalStore.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
