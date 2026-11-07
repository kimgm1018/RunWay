import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, glass, Icon } from '../../components';
import { useRepositories, useResource, type Repositories } from '../../data';
import { formatDuration, isNight } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, spacing, typography, useTheme } from '../../theme';
import { parseClock, parseDistanceKm } from '../onboarding/validation';
import { MapScreenFrame } from './MapScreenFrame';
import { RunMap } from '../../components/RunMap';
import { K1Badge, PlaceCard, RunStartBar } from './parts';

const loadPlace = (repositories: Repositories) =>
  repositories.run.getCurrentPlace();

// One goal field. By day a white glass tile 88 high (runway-course-handoff 목표 타일); at night the white field.
function GoalInput({
  label,
  unit,
  value,
  onChangeText,
  keyboardType,
  invalid,
  night,
}: {
  label: string;
  unit: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType: 'decimal-pad' | 'numbers-and-punctuation';
  invalid: boolean;
  night: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.goal,
        night ? { backgroundColor: colors.surfaceRaised } : styles.goalDay,
        invalid && { borderColor: colors.danger },
      ]}
    >
      <View style={styles.goalHead}>
        <AppText
          variant="captionStrong"
          style={night ? undefined : styles.goalLabel}
        >
          {label}
        </AppText>
        <AppText
          variant="label"
          tone="textTertiary"
          style={night ? undefined : styles.optional}
        >
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
          night ? typography.metricLarge : styles.goalValue,
          styles.goalInput,
          { color: colors.text },
        ]}
      />
      <AppText
        variant="label"
        tone="textTertiary"
        style={night ? undefined : styles.unit}
      >
        {unit}
      </AppText>
    </View>
  );
}

// 2.0F 자유 러닝: start from where you are, with an optional distance and pace goal. By day the
// runway-course-handoff sheet (glass, a white goal panel with two tiles); after sunset the dark sheet.
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
      renderMap={logo => (
        <RunMap
          position={place.status === 'ready' ? place.data.position : undefined}
          area={{ top: 0.36, bottom: 0.36 }}
          logo={logo}
          style={StyleSheet.absoluteFill}
        />
      )}
      top={
        place.status === 'ready' ? (
          <PlaceCard name={place.data.name} gps={place.data.gps} />
        ) : place.status === 'error' ? (
          // A failed lookup stops saying it is still searching; a tap tries again.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="현재 위치 다시 찾기"
            onPress={place.reload}
          >
            <PlaceCard name="못 찾았어요 · 다시 찾기" gps="none" />
          </Pressable>
        ) : (
          <PlaceCard name="현재 위치를 찾는 중이에요" gps="none" />
        )
      }
      bottom={
        <>
          <View style={[styles.mode, !night && styles.modeDay]}>
            <K1Badge diameter={46}>
              <Icon name="compass" color={k1.ice} size={18} />
            </K1Badge>
            <View style={styles.flex}>
              <AppText
                variant="label"
                tone="textTertiary"
                style={night ? undefined : styles.kicker}
              >
                자유 러닝
              </AppText>
              <AppText
                variant="heading"
                style={night ? styles.medium : styles.modeTitle}
              >
                코스 없이 기록만 남겨요
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="러닝 방식 변경"
              onPress={() => navigateTo(navigation, 'RunMode')}
              hitSlop={8}
              style={night ? undefined : styles.change}
            >
              <AppText
                variant="captionStrong"
                style={night ? undefined : styles.changeText}
              >
                변경
              </AppText>
            </Pressable>
          </View>
          <View
            style={[
              styles.goals,
              night
                ? { backgroundColor: colors.surfaceMuted }
                : styles.goalsDay,
            ]}
          >
            <AppText
              variant="captionStrong"
              style={night ? undefined : styles.goalsTitle}
            >
              목표{' '}
              <AppText
                variant="caption"
                tone="textTertiary"
                style={night ? undefined : styles.goalsOptional}
              >
                · 선택
              </AppText>
            </AppText>
            <AppText
              variant="label"
              tone="textSecondary"
              style={night ? undefined : styles.goalsNote}
            >
              거리·페이스 모두 비워도 시작할 수 있어요
            </AppText>
            <View style={[styles.goalRow, !night && styles.goalRowDay]}>
              <GoalInput
                label="거리"
                unit="km"
                value={distance}
                onChangeText={setDistance}
                keyboardType="decimal-pad"
                invalid={distance !== '' && !km}
                night={night}
              />
              <GoalInput
                label="페이스"
                unit="/km · 예 6:00"
                value={pace}
                onChangeText={setPace}
                keyboardType="numbers-and-punctuation"
                invalid={pace !== '' && !paceSec}
                night={night}
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

const ink = '#02050E';
const grey = '#95969A';

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mode: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  modeDay: { height: 46, gap: 12 },
  medium: { fontFamily: fontFamily.medium },
  kicker: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: grey,
  },
  modeTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: ink,
  },
  // 변경 as a small glass badge.
  change: {
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: glass.circleRim,
    backgroundColor: glass.circle,
  },
  changeText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: ink,
  },
  // Grey goal box with white fields inside (DESIGN.md 2-6 시트 안 회색 칸).
  goals: { borderRadius: 22, padding: 16, gap: spacing.sm },
  // By day a white glass panel (radius 26) with the tiles 8 apart.
  goalsDay: {
    borderRadius: 26,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: glass.panel,
  },
  goalsTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: ink,
  },
  goalsOptional: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    color: '#8A8E94',
  },
  goalsNote: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#60636A',
  },
  goalRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  goalRowDay: { gap: 8 },
  goal: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    gap: spacing.xxs,
  },
  goalDay: {
    height: 88,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: glass.tile,
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 0,
    gap: 0,
  },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between' },
  goalLabel: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: ink,
  },
  optional: { fontFamily: fontFamily.regular, fontSize: 12, color: grey },
  // A TextInput clips Noto's tall glyphs at a tight line height, so the field gets its own height.
  goalValue: {
    marginTop: 6,
    height: 26,
    fontFamily: fontFamily.bold,
    fontSize: 18,
    includeFontPadding: false,
  },
  goalInput: { padding: 0 },
  unit: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: grey,
  },
});
