import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, EmptyState, useToast } from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  DataError,
  useRepositories,
  useResource,
  type Repositories,
  type RunningBaseline,
} from '../../data';
import { fontFamily } from '../../theme';
import { KeyboardLift } from '../../components/KeyboardLift';
import {
  changesBaseline,
  describeRunningSaveError,
  PaceCard,
  paceEntryFrom,
  paceFormFrom,
} from '../onboarding/PaceCard';
import { settingsLook } from './SettingsScreen';

// 8.2 opens this only after setup, so a missing profile is a load failure here.
const loadBaseline = async (repositories: Repositories) => {
  const saved = await repositories.profile.getRunningProfile();
  if (!saved) {
    throw new DataError('PROFILE_NOT_SET', '러닝 프로필 없음');
  }
  return saved;
};

function Form({ saved }: { saved: RunningBaseline }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useRepositories();
  const [form, setForm] = useState(() => paceFormFrom(saved));
  const [busy, setBusy] = useState(false);
  // Read synchronously, so a second tap or a back press during the U07 call is caught before the state updates.
  const saving = useRef(false);
  const entry = paceEntryFrom(form);
  const changed = entry !== null && changesBaseline(entry, saved);

  // Leaving while U07 is on its way would let 8.2 read the old pace; back waits for the answer.
  useEffect(
    () =>
      navigation.addListener('beforeRemove', event => {
        if (saving.current) {
          event.preventDefault();
        }
      }),
    [navigation],
  );

  const save = async () => {
    if (!entry || !changed || saving.current) {
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      // The pace alone: U07 keeps the saved level, and the run goals are not touched.
      await profile.saveRunningProfile({ pace: entry });
      saving.current = false;
      toast('평소 러닝 정보를 저장했어요');
      navigation.goBack();
    } catch (error) {
      saving.current = false;
      setBusy(false);
      const failure = describeRunningSaveError(error);
      toast(`${failure.title} ${failure.detail}`);
    }
  };

  const disabled = !changed || busy;
  return (
    <KeyboardLift style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          평소 러닝 정보
        </AppText>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <AppText style={styles.note}>
          평소 달리는 거리와 완주 시간, 또는 페이스를 바꿀 수 있어요. 오늘 러닝
          목표와 진행 중인 러닝은 바뀌지 않아요.
        </AppText>
        <PaceCard form={form} onChange={setForm} level={null} />
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="저장"
          accessibilityState={{ disabled, busy }}
          disabled={disabled}
          onPress={save}
          style={({ pressed }) => [
            styles.save,
            disabled && styles.dim,
            pressed && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <AppText style={styles.saveText}>저장</AppText>
          )}
        </Pressable>
      </View>
    </KeyboardLift>
  );
}

// 8.2b 평소 러닝 정보 (S15P31E105-551): the usual pace from U06, changed with the pace part of U07 only.
export function RunningBaselineEditScreen() {
  const loaded = useResource(loadBaseline);
  // The form keeps its own answers once shown, so it mounts only after U06 loads.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (loaded.status === 'ready') {
      setReady(true);
    }
  }, [loaded.status]);
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      {loaded.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="평소 러닝 정보를 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={loaded.reload}
        />
      ) : !ready || loaded.status !== 'ready' ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <Form saved={loaded.data} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  dim: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
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
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  note: {
    paddingHorizontal: 4,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  save: {
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#02050D',
  },
  saveText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: '#FFFFFF',
  },
});
