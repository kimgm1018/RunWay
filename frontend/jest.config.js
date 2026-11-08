process.env.TZ = 'Asia/Seoul';
module.exports = {
  preset: '@react-native/jest-preset',
  cacheDirectory: '<rootDir>/.cache/jest',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(\\.pnpm|react-native|@react-native|@react-native-community|@react-navigation|react-native-safe-area-context|react-native-screens|react-native-svg|react-native-sse)/)',
  ],
};
