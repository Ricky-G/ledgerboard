import typescriptEslint from "typescript-eslint";

// Globals are declared inline instead of pulling in the `globals` package so the
// lint configuration adds no dependency of its own.
const nodeGlobals = {
  Buffer: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  exports: "writable",
  fetch: "readonly",
  global: "readonly",
  globalThis: "readonly",
  module: "writable",
  performance: "readonly",
  process: "readonly",
  require: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  structuredClone: "readonly",
};

const browserGlobals = {
  CustomEvent: "readonly",
  Blob: "readonly",
  DataTransfer: "readonly",
  DragEvent: "readonly",
  Element: "readonly",
  Event: "readonly",
  EventSource: "readonly",
  HTMLElement: "readonly",
  Intl: "readonly",
  KeyboardEvent: "readonly",
  MessageEvent: "readonly",
  Node: "readonly",
  URL: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  document: "readonly",
  fetch: "readonly",
  getComputedStyle: "readonly",
  localStorage: "readonly",
  navigator: "readonly",
  performance: "readonly",
  requestAnimationFrame: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  structuredClone: "readonly",
  window: "readonly",
};

const sharedRules = {
  curly: "error",
  eqeqeq: ["error", "smart"],
  "no-throw-literal": "error",
  semi: "error",
  "no-var": "error",
  "prefer-const": "error",
};

const javascriptRules = {
  ...sharedRules,
  // The existing Node and webview sources use single-line guard clauses.
  // `multi-line` keeps the brace requirement where it prevents real mistakes
  // without forcing a reformat of the entire domain model.
  curly: ["error", "multi-line"],
  "no-undef": "error",
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
};

export default [
  {
    ignores: [
      ".vscode-test/**",
      "dist/**",
      "out/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "**/*.vsix",
    ],
  },
  {
    files: ["src/**/*.ts"],
    plugins: { "@typescript-eslint": typescriptEslint.plugin },
    languageOptions: {
      parser: typescriptEslint.parser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: {
      ...sharedRules,
      "@typescript-eslint/naming-convention": [
        "warn",
        { selector: "import", format: ["camelCase", "PascalCase"] },
      ],
    },
  },
  {
    // Node-side automation: build scripts, test suites, and shared fixtures.
    files: ["scripts/**/*.js", "test/**/*.js", "esbuild.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: nodeGlobals,
    },
    rules: javascriptRules,
  },
  {
    files: [
      "*.mjs",
      "scripts/**/*.mjs",
      "test/**/*.mjs",
      ".github/extensions/**/*.mjs",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: nodeGlobals,
    },
    rules: javascriptRules,
  },
  {
    // Webview runtime. `board-model.js` also carries a CommonJS shim so Node
    // tests and the webview can load exactly the same domain code.
    files: [
      "media/**/*.js",
      ".github/extensions/**/harness.js",
      "test/webview/harness/client.js",
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...browserGlobals,
        acquireVsCodeApi: "readonly",
        module: "writable",
        require: "readonly",
      },
    },
    rules: javascriptRules,
  },
  {
    // Playwright specs run in Node but embed browser callbacks that Playwright
    // serializes and evaluates inside the page, so both global sets apply.
    files: ["playwright.config.mjs", "test/webview/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...nodeGlobals, ...browserGlobals },
    },
    rules: javascriptRules,
  },
];
