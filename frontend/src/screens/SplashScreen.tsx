import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StartArt } from './onboarding/StartScreen';

// The launch splash while the saved tokens load (S15P31E105-425): the same picture as 1.1 시작 without its
// button, so a signed-out user sees 시작하기 appear on the same screen and a signed-in user moves on to home.
export function SplashScreen() {
  return (
    <View style={styles.root} accessible accessibilityLabel="RUNWAY">
      <StartArt />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#D5D9DD' },
});
