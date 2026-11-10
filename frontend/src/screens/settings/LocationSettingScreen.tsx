import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, EmptyState, useToast } from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  useRepositories,
  useResource,
  type LocationRecordingMode,
  type Repositories,
} from '../../data';
import { errorCode } from '../../data/errors';
import { fontFamily } from '../../theme';
import { locationLabels, settingsLook } from './SettingsScreen';

const modes: LocationRecordingMode[] = ['ALWAYS', 'RUNNING_ONLY', 'OFF'];

const loadSettings = (repositories: Repositories) =>
  repositories.settings.get();

// The switch drawn at the end of a row: 46 × 28, navy when on.
function Switch({ on }: { on: boolean }) {
  return (
    <View style={[styles.track, on ? styles.trackOn : styles.trackOff]}>
      <View style={[styles.knob, on ? styles.knobOn : styles.knobOff]} />
    </View>
  );
}

// 8.1b 위치 기록 (runway-settings, 담당자 결정: 8.1에서 분리): 항상 · 러닝 중에만 · 끔, one of them on. A tap
// on another saves it at once (U20) and rolls back on failure.
export function LocationSettingScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { settings: settingsApi } = useRepositories();
  const loaded = useResource(loadSettings);
  const [mode, setMode] = useState<LocationRecordingMode | null>(null);
  // Only a new answer sets the mode, so a choice is not put back on the next render.
  const data = loaded.status === 'ready' ? loaded.data : null;
  useEffect(() => {
    if (data) {
      setMode(data.locationRecordingMode);
    }
  }, [data]);

  const [saving, setSaving] = useState(false);
  const choose = async (next: LocationRecordingMode) => {
    if (!mode || next === mode || saving) {
      return;
    }
    setSaving(true);
    const before = mode;
    setMode(next);
    try {
      setMode(
        (await settingsApi.update({ locationRecordingMode: next }))
          .locationRecordingMode,
      );
    } catch (error) {
      if (errorCode(error) === 'SAVE_UNCONFIRMED') {
        toast('저장했어요. 최신 설정을 불러오지 못했어요');
      } else {
        setMode(before);
        toast('설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          위치 기록
        </AppText>
      </View>
      {loaded.status === 'error' && !mode ? (
        <EmptyState
          icon="alert"
          title="설정을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={loaded.reload}
        />
      ) : !mode ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.list} accessibilityRole="radiogroup">
          {modes.map(item => (
            <Pressable
              key={item}
              accessibilityRole="switch"
              accessibilityLabel={locationLabels[item]}
              accessibilityState={{ checked: item === mode, disabled: saving }}
              disabled={saving}
              onPress={() => choose(item)}
              style={({ pressed }) => [
                styles.row,
                saving && styles.pressed,
                pressed && !saving && styles.pressed,
              ]}
            >
              <AppText style={styles.rowText}>{locationLabels[item]}</AppText>
              <Switch on={item === mode} />
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loading: { marginTop: 48 },
  pressed: { opacity: 0.6 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: settingsLook.ink,
  },
  // Rows of 60 between white lines, 24 from the edges.
  list: {
    marginTop: 12,
    marginHorizontal: 24,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  row: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  rowText: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  track: { width: 46, height: 28, borderRadius: 14 },
  trackOn: { backgroundColor: settingsLook.ink },
  trackOff: { backgroundColor: 'rgba(24,46,61,0.16)' },
  knob: {
    position: 'absolute',
    top: 3,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
  },
  knobOn: { right: 3 },
  knobOff: { left: 3, boxShadow: '0 2px 6px rgba(9,17,26,0.18)' },
});
