import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Icon } from '../../components';
import { useRepositories, useResource, type Repositories } from '../../data';
import { formatDuration, isNight } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { palette, radius, spacing, typography, useTheme } from '../../theme';
import { parseClock, parseDistanceKm } from '../onboarding/validation';
import { MapScreenFrame } from './MapScreenFrame';
import { MockMap } from './MockMap';
import { PlaceCard, RunStartBar } from './parts';

const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

function GoalInput({
  label,
  unit,
  value,
  onChangeText,
  keyboardType,
  invalid,
}: {
  label: string;
  unit: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType: 'decimal-pad' | 'numbers-and-punctuation';
  invalid: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.goal,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: invalid ? colors.danger : colors.border,
        },
      ]}
    >
      <View style={styles.goalHead}>
        <AppText variant="captionStrong">{label}</AppText>
        <AppText variant="label" tone="textTertiary">
          선택
        </AppText>
      </View>
      <TextInput
        accessibilityLabel={`${label} 목표`}
        value={value}
        onChangeText={onChangeText}
        placeholder="–"
        placeholderTextColor={colors.text}
        keyboardType={keyboardType}
        selectionColor={colors.accent}
        style={[
          typography.metricLarge,
          styles.goalInput,
          { color: colors.text },
        ]}
      />
      <AppText variant="label" tone="textTertiary">
        {unit}
      </AppText>
    </View>
  );
}

// 2.0F 자유 러닝: start from where you are, with an optional distance and pace goal.
export function FreeRunScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const night = isNight(clock.now());
  const place = useResource(useCallback(loadPlace, []));
  const [distance, setDistance] = useState('');
  const [pace, setPace] = useState('');
  const km = parseDistanceKm(distance);
  const paceSec = parseClock(pace);
  // Only when both are set is the finish time worked out, shown apart from the goals themselves.
  const expected = km && paceSec ? km * paceSec : null;

  return (
    <MapScreenFrame
      map={
        <MockMap
          night={night}
          position={place.status === 'ready' ? place.data.position : undefined}
        />
      }
      top={
        place.status === 'ready' ? (
          <PlaceCard name={place.data.name} gps={place.data.gps} />
        ) : (
          <PlaceCard name="현재 위치를 찾는 중이에요" gps="none" />
        )
      }
      bottom={
        <>
          <View style={styles.mode}>
            <View style={[styles.modeIcon, { backgroundColor: palette.ink }]}>
              <Icon name="compass" color={palette.white} size={18} />
            </View>
            <View style={styles.flex}>
              <AppText variant="label" tone="textTertiary">
                자유 러닝
              </AppText>
              <AppText variant="heading">코스 없이 기록만 남겨요</AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="러닝 방식 변경"
              onPress={() => navigateTo(navigation, 'RunMode')}
              hitSlop={8}
            >
              <AppText variant="captionStrong">변경</AppText>
            </Pressable>
          </View>
          <View
            style={[styles.goals, { backgroundColor: colors.surfaceMuted }]}
          >
            <AppText variant="captionStrong">
              목표{' '}
              <AppText variant="caption" tone="textTertiary">
                · 선택
              </AppText>
            </AppText>
            <AppText variant="label" tone="textSecondary">
              거리·페이스 모두 비워도 시작할 수 있어요
            </AppText>
            <View style={styles.goalRow}>
              <GoalInput
                label="거리"
                unit="km"
                value={distance}
                onChangeText={setDistance}
                keyboardType="decimal-pad"
                invalid={distance !== '' && !km}
              />
              <GoalInput
                label="페이스"
                unit="/km · 예 6:00"
                value={pace}
                onChangeText={setPace}
                keyboardType="numbers-and-punctuation"
                invalid={pace !== '' && !paceSec}
              />
            </View>
            {expected ? (
              <AppText variant="label" tone="textSecondary">
                {`예상 완주 시간 ${formatDuration(
                  expected,
                )} · 목표와 별개로 계산한 값이에요`}
              </AppText>
            ) : null}
          </View>
          <RunStartBar
            night={night}
            config={{
              mode: 'FREE',
              plan: null,
              goalDistanceM: km ? Math.round(km * 1000) : null,
              goalPaceSecPerKm: paceSec,
            }}
          />
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  modeIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goals: { borderRadius: radius.lg, padding: spacing.xl, gap: spacing.sm },
  goalRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  goal: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xxs,
  },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between' },
  goalInput: { padding: 0 },
});
