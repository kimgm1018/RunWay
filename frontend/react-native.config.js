module.exports = {
  assets: ['./assets/fonts'],
  dependencies: {
    '@kingstinct/react-native-healthkit': { platforms: { android: null } },
    '@react-native-healthkit/core': { platforms: { android: null } },
    // S15P31E105-815 (ADR-0025): device push is Android only; iOS (APNs) is out of scope, so no Firebase pods.
    '@react-native-firebase/app': { platforms: { ios: null } },
    '@react-native-firebase/messaging': { platforms: { ios: null } },
  },
};
