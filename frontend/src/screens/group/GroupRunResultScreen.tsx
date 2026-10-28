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
  EmptyState,
  Icon,
  IconButton,
} from '../../components';
import { useRepositories, type GroupRunResult } from '../../data';
import { formatDuration, formatKm, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import type { RootStackParamList } from '../../navigation/types';
import { radius, size, spacing, useTheme } from '../../theme';
import { useRunSession } from '../run/RunSession';
import { FooterButton } from './GroupRunDetailScreen';

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
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <AppText variant="label" tone="textTertiary">
        {label}
      </AppText>
      <AppText variant="metricLarge">
        {value}
        {unit ? (
          <AppText variant="caption" tone="textTertiary">
            {` ${unit}`}
          </AppText>
        ) : null}
      </AppText>
    </View>
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
      <SafeAreaView edges={['top']}>
        <View style={styles.header}>
          <IconButton icon="back" accessibilityLabel="뒤로" onPress={done} />
          <AppText variant="heading" accessibilityRole="header">
            {result.title}
          </AppText>
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText
          variant="display"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={styles.headline}
        >
          {`${rows.length}명 중 ${finished}명 완주했어요`}
        </AppText>
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
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.rowBetween}>
            <AppText variant="bodyStrong">완주 현황</AppText>
            {mine ? (
              <AppText variant="label" tone="textTertiary">
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
                  variant="body"
                  tone={row.goalAchieved ? 'text' : 'textTertiary'}
                >
                  {row.nickname}
                </AppText>
                {row.isMe ? (
                  <View
                    style={[styles.meBadge, { backgroundColor: colors.accent }]}
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
                <AppText variant="caption" tone="textTertiary">
                  {`${formatKm(row.distanceM, 1)}km에서 중단`}
                </AppText>
              ) : (
                <View style={styles.nameLine}>
                  <AppText variant="metric">
                    {formatDuration(row.durationSec)}
                  </AppText>
                  <Icon name="check" color={colors.accentText} size={16} />
                </View>
              )}
            </View>
          ))}
        </View>
        <AppText variant="caption" tone="textTertiary" style={styles.note}>
          이번 내 기록은 내 기록 › 그룹런 탭에 남아요
        </AppText>
      </ScrollView>
      <SafeAreaView
        edges={['bottom']}
        style={[styles.footer, { backgroundColor: colors.background }]}
      >
        <FooterButton
          title="내 그룹런 기록 공유"
          onPress={() => navigateTo(navigation, 'PostWrite')}
        />
        <FooterButton title="완료" primary onPress={done} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: spacing.xxxl },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  content: {
    padding: spacing.screen,
    gap: spacing.xl,
    paddingBottom: spacing.xxxl * 4,
  },
  headline: { marginTop: spacing.xxxl * 2 },
  stats: { flexDirection: 'row', gap: spacing.md },
  stat: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    gap: spacing.xxs,
  },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.xs,
  },
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
  meBadge: { paddingHorizontal: spacing.sm, borderRadius: radius.pill },
  note: { textAlign: 'center' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xl,
  },
});
