module.exports = {
  testEnvironment: "node",


  setupFiles: [
    "<rootDir>/backend/tests/setup.js",
  ],


  testMatch: [
    "<rootDir>/backend/tests/**/*.test.js",
  ],


  collectCoverageFrom: [
    "backend/**/*.js",
    "!backend/tests/**",
  ],
};