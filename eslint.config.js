import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      ".npm-cache/**",
      "**/public/**",
      "coverage/**",
      "data/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-console": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-useless-assignment": "warn",
      "no-regex-spaces": "warn",
    },
  },
  {
    // Browser-side assets (served to the client)
    files: ["apps/web/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
];
