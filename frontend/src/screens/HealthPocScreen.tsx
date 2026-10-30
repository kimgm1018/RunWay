import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StyleSheet } from 'react-native';
import { ScreenHeader } from '../components';
import { provider } from '../health/healthProvider';
import { palette, ThemeProvider } from '../theme';
import { HealthScreen } from './HealthScreen';

// S15P31E105-60 health data PoC, kept reachable from the developer menu. Its styles are dark-only.
export function HealthPocScreen() {
  const navigation = useNavigation();
  return (
    <ThemeProvider tone="dark">
      <SafeAreaView style={styles.root}>
        <ScreenHeader title="건강 데이터 PoC" onBack={navigation.goBack} />
        <HealthScreen provider={provider} />
      </SafeAreaView>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.night },
});
