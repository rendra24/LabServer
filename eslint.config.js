const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/", "dist/", "src/renderer/vendor/", ".superpowers/", ".devdata/"] },
  js.configs.recommended,
  {
    files: ["src/main/**/*.js", "src/preload/**/*.js", "test/**/*.js", "scripts/**/*.js", "*.js"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
  },
  {
    files: ["src/renderer/**/*.js"],
    languageOptions: { sourceType: "module", globals: globals.browser },
  },
];
