import React, { useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';
import { AppText, Button, ScreenHeader } from '../components';
import { RunMap, RunMapRef } from '../components/RunMap';
import { recommendedCourses } from '../data/mock/fixtures';
import { palette, spacing, ThemeProvider } from '../theme';

// S15P31E105-180 map check (ADR-0018): the Naver map, a course line and the current location on a device.
export function MapPocScreen() {
  const navigation = useNavigation();
  const map = useRef<RunMapRef>(null);
  const [progress, setProgress] = useState(0);
  const [locating, setLocating] = useState(false);
  const [status, setStatus] = useState('지도와 코스 선을 확인하세요.');

  async function showMyLocation() {
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        setStatus('위치 권한이 없어 현재 위치를 표시하지 못했습니다.');
        return;
      }
    }
    setLocating(true);
    map.current?.setLocationTrackingMode('Follow');
    setStatus('현재 위치를 따라갑니다.');
  }

  return (
    <ThemeProvider tone="dark">
      <SafeAreaView style={styles.root}>
        <ScreenHeader title="지도 확인" onBack={navigation.goBack} />
        <RunMap
          ref={map}
          style={styles.map}
          route={recommendedCourses[0].route}
          progress={progress}
          showLocation={locating}
        />
        <View style={styles.actions}>
          <AppText variant="body">{status}</AppText>
          <Button
            title="현재 위치"
            variant="secondary"
            size="medium"
            onPress={showMyLocation}
          />
          <Button
            title={`진행 구간 ${Math.round(progress * 100)}%`}
            variant="secondary"
            size="medium"
            onPress={() =>
              setProgress(value => (value >= 1 ? 0 : value + 0.25))
            }
          />
        </View>
      </SafeAreaView>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.night },
  map: { flex: 1 },
  actions: { gap: spacing.md, padding: spacing.screen },
});
