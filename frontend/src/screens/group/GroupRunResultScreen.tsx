import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Card,
  EmptyState,
  Icon,
  IconButton,
} from '../../components';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import {
  fontFamily,
  k1,
  spacing,
  ThemeProvider,
  useTheme,
} from '../../theme';
import { RouteLine } from '../course/RouteLine';
import { useRunSession } from '../run/RunSession';
import { FooterButton } from './GroupRunDetailScreen';
import { BottomFade } from './parts';

const stateOrder = { FINISHED: 0, RUNNING: 1, STOPPED: 2 };

function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  const { colors } = useTheme();
  // A see-through tile of the background color, as on 6.4.
  return (
    <View style={[styles.stat, { backgroundColor: colors.glass }]}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <AppText style={styles.statValue}>
        {value}
        {unit ? (
          <AppText variant="label" tone="textSecondary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
  );
}

// The art card at the top (DESIGN.md 2-10 결과): the course loop at 40% on the course card, the back
// button and the run's title chip on top, and the result line at the bottom.
function ArtCard({
  title,
  headline,
  route,
  onBack,
}: {
  title: string;
  headline: string;
  route: [number, number][] | null;
  onBack: () => void;
}) {
  return (
    <Card variant="course" style={styles.art}>
      {route ? (
        <View style={styles.artRoute}>
          <RouteLine route={route} />
        </View>
      ) : null}
      <View style={styles.artTop}>
        <IconButton icon="back" accessibilityLabel="뒤로" onPress={onBack} />
        <View style={styles.titleChip}>
          <AppText variant="labelStrong" numberOfLines={1}>
            {title}
          </AppText>
        </View>
      </View>
      <AppText style={styles.headline} accessibilityRole="header">
        {headline}
      </AppText>
    </Card>
  );
}

// 6.7 그룹런 결과: who finished the goal fixed at the start, without ranks.
export function GroupRunResultScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'GroupRunResult'>>();
  const { colors } = useTheme();
  const { groupRuns } = useRepositories();
  const { run } = useRunSession();
  const groupRunId =
    route.params?.groupRunId ?? run?.config.groupRunId ?? 'gr-today';
  const [result, setResult] = useState<GroupRunResult | null>(null);
  const [failed, setFailed] = useState(false);
  // My record joins the result once it is saved (4.5와 같은 저장 흐름).
  const saved = !run || run.saveState === 'saved' || run.saveState === 'failed';

  const load = useCallback(() => {
    setFailed(false);
    groupRuns.getResult(groupRunId).then(setResult, () => setFailed(true));
  }, [groupRunId, groupRuns]);
  useEffect(() => {
    if (saved) {
      load();
    }
  }, [load, saved]);

  const done = useCallback(
    () => navigateTo(navigation, 'MyCrews'),
    [navigation],
  );
  useFocusEffect(
    useCallback(() => {
      const back = BackHandler.addEventListener('hardwareBackPress', () => {
        done();
        return true;
      });
      return () => back.remove();
    }, [done]),
  );

  if (!result) {
    return (
      <SafeAreaView
        style={[styles.root, { backgroundColor: colors.background }]}
      >
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Backdrop />
        </View>
        {failed ? (
          <EmptyState
            icon="alert"
            title="결과를 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={load}
          />
        ) : (
          <ActivityIndicator style={styles.loading} />
        )}
      </SafeAreaView>
    );
  }

  const rows = [...result.participants].sort(
    (a, b) =>
      stateOrder[a.state] - stateOrder[b.state] ||
      Number(b.goalAchieved) - Number(a.goalAchieved) ||
      a.durationSec - b.durationSec,
  );
  const finished = rows.filter(row => row.goalAchieved).length;
  const mine = rows.find(row => row.isMe);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <SafeAreaView edges={['top']} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <ArtCard
            title={result.title}
            headline={`${rows.length}명 중 ${finished}명 완주했어요`}
            route={run?.config.plan?.route ?? null}
            onBack={done}
          />
          <View style={styles.stats}>
            <Stat
              label="함께 달린 거리"
              value={formatKm(result.distanceM, 1)}
              unit="km"
            />
            <Stat
              label="그룹 평균"
              value={formatPace(result.averagePaceSecPerKm)}
            />
            <Stat label="최대 간격" value={String(result.maxGapM)} unit="m" />
          </View>
          <Card variant="solid" style={styles.card}>
            <View style={styles.rowBetween}>
              <AppText variant="bodyMedium">완주 현황</AppText>
              {mine ? (
                <AppText variant="label" tone="textSecondary">
                  {`내 기록 ${formatDuration(mine.durationSec)}`}
                </AppText>
              ) : null}
            </View>
            {rows.map((row, index) => (
              <View
                key={row.userId}
                style={[
                  styles.row,
                  index > 0 && {
                    borderTopColor: colors.border,
                    borderTopWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={[styles.flex, styles.nameLine]}>
                  <AppText
                    variant="bodyMedium"
                    tone={row.state === 'RUNNING' ? 'textTertiary' : 'text'}
                  >
                    {row.nickname}
                  </AppText>
                  {row.isMe ? (
                    <View
                      style={[
                        styles.meBadge,
                        { backgroundColor: colors.accent },
                      ]}
                    >
                      <AppText
                        variant="labelStrong"
                        style={{ color: colors.onAccent }}
                      >
                        나
                      </AppText>
                    </View>
                  ) : null}
                </View>
                {row.state === 'RUNNING' ? (
                  <AppText variant="caption" tone="textTertiary">
                    달리는 중
                  </AppText>
                ) : row.goalAchieved === false || row.state === 'STOPPED' ? (
                  // A run that stopped short of the goal is the coral line (DESIGN.md 2-10 미달성).
                  <AppText variant="caption" style={styles.missed}>
                    {`${formatKm(row.distanceM, 1)}km에서 중단`}
                  </AppText>
                ) : (
                  <View style={styles.nameLine}>
                    <AppText style={styles.time}>
                      {formatDuration(row.durationSec)}
                    </AppText>
                    <Icon name="check" color={colors.text} size={14} />
                  </View>
                )}
              </View>
            ))}
          </Card>
          <AppText variant="caption" tone="textSecondary" style={styles.note}>
            이번 내 기록은 내 기록 › 그룹런 탭에 남아요
          </AppText>
        </ScrollView>
      </SafeAreaView>
      {/* The buttons sit on the black lower part. */}
      <ThemeProvider tone="dark">
        <SafeAreaView edges={['bottom']} style={styles.footer}>
          <BottomFade />
          <FooterButton
            title="내 그룹런 기록 공유"
            onPress={() => navigateTo(navigation, 'PostWrite')}
          />
          <FooterButton title="완료" primary onPress={done} />
        </SafeAreaView>
      </ThemeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  content: {
    padding: 14,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl * 4,
  },
  art: {
    height: 250,
    padding: 18,
    justifyContent: 'space-between',
  },
  // The loop sits at 40% above the result line, behind the button.
  artRoute: {
    position: 'absolute',
    top: 16,
    bottom: 70,
    left: 60,
    right: 60,
    opacity: 0.4,
  },
  artTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleChip: {
    maxWidth: '60%',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: 'rgba(2,5,14,0.55)',
  },
  headline: {
    fontFamily: fontFamily.medium,
    fontSize: 24,
    lineHeight: 33,
    letterSpacing: -0.5,
  },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    height: 92,
    borderRadius: 22,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  statValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 21,
    lineHeight: 26,
  },
  card: { gap: spacing.xs },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  meBadge: { paddingHorizontal: spacing.md, borderRadius: 999 },
  time: { fontFamily: fontFamily.numberMedium, fontSize: 15 },
  missed: { color: k1.coralText },
  note: { textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: 14,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
});
