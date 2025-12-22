// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  {
    ignores: ["main.js", "node_modules/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      obsidianmd,
    },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },

    // You can add your own configuration to override or add rules
    rules: {
      ...obsidianmd.configs.recommended,
      // example: turn off a rule from the recommended set
      "obsidianmd/sample-names": "off",
      // example: add a rule not in the recommended set and set its severity
      "obsidianmd/prefer-file-manager-trash-file": "error",
      "obsidianmd/ui/sentence-case": ["warn", {
        "acronyms": ["OCR"]
      }],
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    plugins: {
      obsidianmd,
    },
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        "acronyms": ["OCR"]
      }],
    }
  }
]);
