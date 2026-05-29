module.exports = {
  testEnvironment: 'jsdom',

  // chrome.* API mocks (setupFiles は test framework インストール前に実行される)
  setupFiles: ['jest-webextension-mock'],
  // setup.js の beforeEach/afterEach は各テストファイルが require() で読み込む

  testMatch: ['**/tests/unit/**/*.test.js'],

  collectCoverageFrom: [
    'background.js',
    'content.js',
    '!**/node_modules/**',
  ],

  verbose: true,
};
