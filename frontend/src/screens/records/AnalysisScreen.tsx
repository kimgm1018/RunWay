import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline, Text } from 'react-native-svg';
import { AppText, EmptyState, IconButton, Segmented } from '../../components';
import {
  useRepositories,
  useResource,
  type AnalysisPeriod,
  type PaceTrend,
  type PeriodSummary,
  type Repositories,
  type RunStatistics,
} from '../../data';
import { formatHours, formatKm, formatPace } from '../../format';
import {
  fontFamily,
  palette,
  radius,
  size,
  spacing,
  useTheme,
} from '../../theme';
import {
  PeriodStepper,
  addDays,
  kstDay,
  mondayOf,
  shiftMonth,
  shortDay,
} from './parts';

const periods: { value: AnalysisPeriod; label: string }[] = [
  { value: 'WEEK', label: '주' },
  { value: 'MONTH', label: '월' },
  { value: 'YEAR', label: '년' },
];

// The first day of the period that holds the day.
function startOf(period: AnalysisPeriod, day: string) {
  if (period === 'WEEK') {
    return mondayOf(day);
  }
  return period === 'MONTH'
    ? `${day.slice(0, 7)}-01`
    : `${day.slice(0, 4)}-01-01`;
}

function shift(period: AnalysisPeriod, start: string, steps: number) {
  if (period === 'WEEK') {
    return addDays(start, steps * 7);
  }
  return period === 'MONTH'
    ? `${shiftMonth(start.slice(0, 7), steps)}-01`
    : `${Number(start.slice(0, 4)) + steps}-01-01`;
}

function labelOf(period: AnalysisPeriod, start: string) {
  if (period === 'WEEK') {
    return `${shortDay(start)} – ${shortDay(addDays(start, 6))}`;
  }
  return period === 'MONTH'
    ? `${start.slice(0, 4)}년 ${Number(start.slice(5, 7))}월`
    : `${start.slice(0, 4)}년`;
}

const copy = {
  WEEK: {
    bars: '요일별 거리',
    compare: '지난주와 비교',
    labels: ['월', '화', '수', '목', '금', '토', '일'],
  },
  MONTH: {
    bars: '주별 거리',
    compare: '지난달과 비교',
    labels: [] as string[],
  },
  YEAR: { bars: '월별 거리', compare: '지난해와 비교', labels: [] as string[] },
};

function barLabels(period: AnalysisPeriod, count: number) {
  if (period === 'WEEK') {
    return copy.WEEK.labels;
  }
  return Array.from({ length: count }, (_, index) =>
    period === 'MONTH' ? `${index + 1}주` : `${index + 1}`,
  );
}

function Card({
  title,
  note,
  children,
}: {
  title?: string;
  note?: string;
  children: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {title ? (
        <View style={styles.cardTitle}>
          <AppText variant="heading" style={styles.cardHeading}>
            {title}
          </AppText>
          {note ? (
            <AppText variant="label" tone="textTertiary">
              {note}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function SummaryGrid({ summary }: { summary: PeriodSummary }) {
  const cell = (value: string, unit: string, label: string) => (
    <View style={styles.summaryCell}>
      <AppText variant="metricLarge">
        {value}
        <AppText variant="caption" tone="textSecondary">
          {unit}
        </AppText>
      </AppText>
      <AppText variant="caption" tone="textTertiary">
        {label}
      </AppText>
    </View>
  );
  return (
    <Card>
      <View style={styles.summaryRow}>
        {cell(String(summary.runCount), '회', '러닝')}
        {cell(formatKm(summary.totalDistanceM, 1), 'km', '누적 거리')}
      </View>
      <View style={styles.summaryRow}>
        {cell(
          summary.averagePaceSecPerKm === null
            ? '– –'
            : formatPace(summary.averagePaceSecPerKm),
          '',
          '평균 페이스',
        )}
        {cell(formatHours(summary.totalDurationSec), 'h', '총 시간')}
      </View>
    </Card>
  );
}

const barArea = 96;

function DistanceBars({
  period,
  breakdown,
}: {
  period: AnalysisPeriod;
  breakdown: number[];
}) {
  const { colors } = useTheme();
  const labels = barLabels(period, breakdown.length);
  const top = Math.max(...breakdown, 1);
  const best = breakdown.indexOf(Math.max(...breakdown));
  return (
    <Card title={copy[period].bars} note="km">
      <View style={styles.bars}>
        {breakdown.map((distanceM, index) => {
          const highlighted = distanceM > 0 && index === best;
          return (
            <View key={labels[index]} style={styles.barColumn}>
              <AppText
                variant="metricSmall"
                tone={highlighted ? 'text' : 'textSecondary'}
                style={period === 'YEAR' && styles.small}
              >
                {distanceM > 0 ? String(Math.round(distanceM / 100) / 10) : ''}
              </AppText>
              <View
                style={[
                  styles.bar,
                  {
                    height: Math.max(
                      (distanceM / top) * barArea,
                      distanceM > 0 ? 6 : 2,
                    ),
                    backgroundColor: highlighted
                      ? colors.accent
                      : colors.surfaceMuted,
                    borderColor: highlighted
                      ? colors.accent
                      : colors.borderStrong,
                  },
                ]}
              />
              <AppText variant="label" tone="textTertiary">
                {labels[index]}
              </AppText>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const trendHeight = 110;

function PaceTrendCard({ trend }: { trend: PaceTrend }) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const known = trend.items.filter(item => item.averagePaceSecPerKm !== null);
  const paces = known.map(item => item.averagePaceSecPerKm as number);
  const [fast, slow] = [Math.min(...paces), Math.max(...paces)];
  const step = width / trend.items.length;
  const x = (index: number) => step * index + step / 2;
  // As on 5.3, a slower month sits higher, so getting faster reads as a falling line.
  const y = (pace: number) =>
    12 + ((slow - pace) / Math.max(slow - fast, 1)) * (trendHeight - 34);
  const points = trend.items
    .map((item, index) =>
      item.averagePaceSecPerKm === null
        ? null
        : { x: x(index), y: y(item.averagePaceSecPerKm) },
    )
    .filter((point): point is { x: number; y: number } => point !== null);
  const first = known[0]?.averagePaceSecPerKm ?? null;
  const last = known[known.length - 1]?.averagePaceSecPerKm ?? null;
  const change = trend.changeSecPerKm;
  return (
    <Card title="평균 페이스 추이" note={`최근 ${trend.items.length}개월`}>
      <View
        style={styles.trend}
        onLayout={event => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && points.length > 0 ? (
          <Svg width={width} height={trendHeight}>
            <Polyline
              points={points.map(point => `${point.x},${point.y}`).join(' ')}
              stroke={colors.accentText}
              strokeWidth={2}
              fill="none"
              strokeLinejoin="round"
            />
            {points.map((point, index) => {
              const latest = index === points.length - 1;
              return (
                <Circle
                  key={`${point.x}`}
                  cx={point.x}
                  cy={point.y}
                  r={latest ? 5 : 2.5}
                  fill={latest ? palette.white : colors.accentText}
                  stroke={latest ? colors.accentText : 'none'}
                  strokeWidth={2}
                />
              );
            })}
            {trend.items.map((item, index) => {
              const latest = index === trend.items.length - 1;
              return (
                <Text
                  key={item.month}
                  x={x(index)}
                  y={trendHeight - 4}
                  fontSize={11}
                  fontFamily={latest ? fontFamily.bold : fontFamily.regular}
                  fill={latest ? colors.text : colors.textTertiary}
                  textAnchor="middle"
                >
                  {`${Number(item.month.slice(5))}월`}
                </Text>
              );
            })}
          </Svg>
        ) : null}
      </View>
      {first !== null && last !== null && change !== null && change !== 0 ? (
        <AppText variant="caption" tone="textSecondary">
          {`${formatPace(first)}에서 ${formatPace(last)}까지 `}
          <AppText variant="captionStrong" tone="accentText">
            {change < 0 ? `${-change}초 빨라졌어요` : `${change}초 느려졌어요`}
          </AppText>
        </AppText>
      ) : null}
    </Card>
  );
}

const zones = [
  { name: '회복', color: palette.slate },
  { name: '유산소', color: palette.mint },
  { name: '템포', color: palette.lavender },
  { name: '역치', color: palette.coral },
  { name: '최대', color: palette.coralStrong },
];

function HeartZones({ shares }: { shares: number[] }) {
  return (
    <Card title="심박 구간">
      {shares.length === 0 ? (
        <AppText variant="caption" tone="textTertiary">
          이 기간에는 심박 기록이 없어요
        </AppText>
      ) : (
        <>
          <View style={styles.zoneBar}>
            {shares.map((share, index) => (
              <View
                key={zones[index].name}
                style={{ flex: share, backgroundColor: zones[index].color }}
              />
            ))}
          </View>
          {shares.map((share, index) => (
            <View key={zones[index].name} style={styles.zoneRow}>
              <View
                style={[
                  styles.zoneDot,
                  { backgroundColor: zones[index].color },
                ]}
              />
              <AppText
                variant="caption"
                tone="textSecondary"
                style={styles.flex}
              >
                {`${index + 1} ${zones[index].name}`}
              </AppText>
              <AppText variant="captionStrong">{`${Math.round(
                share * 100,
              )}%`}</AppText>
            </View>
          ))}
        </>
      )}
    </Card>
  );
}

function Comparison({
  period,
  start,
  current,
  previous,
  isCurrent,
}: {
  period: AnalysisPeriod;
  start: string;
  current: PeriodSummary;
  previous: PeriodSummary | null;
  isCurrent: boolean;
}) {
  const { colors } = useTheme();
  const before = shift(period, start, -1);
  const [previousLabel, currentLabel] =
    period === 'WEEK'
      ? isCurrent
        ? ['지난주', '이번 주']
        : [`${shortDay(before)}주`, `${shortDay(start)}주`]
      : period === 'MONTH'
      ? [`${Number(before.slice(5, 7))}월`, `${Number(start.slice(5, 7))}월`]
      : [`${before.slice(0, 4)}년`, `${start.slice(0, 4)}년`];
  const earlier = previous ?? {
    runCount: 0,
    totalDistanceM: 0,
    totalDurationSec: 0,
    averagePaceSecPerKm: null,
  };
  const countGap = current.runCount - earlier.runCount;
  const distanceGap = current.totalDistanceM - earlier.totalDistanceM;
  const paceGap =
    current.averagePaceSecPerKm !== null && earlier.averagePaceSecPerKm !== null
      ? current.averagePaceSecPerKm - earlier.averagePaceSecPerKm
      : null;
  const sign = (value: number) => (value > 0 ? '+' : value < 0 ? '−' : '');
  const rows = [
    {
      label: '러닝 횟수',
      before: `${earlier.runCount}회`,
      now: `${current.runCount}회`,
      gap: `${sign(countGap)}${Math.abs(countGap)}회`,
      better: countGap >= 0,
    },
    {
      label: '누적 거리',
      before: `${formatKm(earlier.totalDistanceM, 1)}km`,
      now: `${formatKm(current.totalDistanceM, 1)}km`,
      gap: `${sign(distanceGap)}${formatKm(Math.abs(distanceGap), 1)}km`,
      better: distanceGap >= 0,
    },
    {
      label: '평균 페이스',
      before:
        earlier.averagePaceSecPerKm === null
          ? '– –'
          : formatPace(earlier.averagePaceSecPerKm),
      now:
        current.averagePaceSecPerKm === null
          ? '– –'
          : formatPace(current.averagePaceSecPerKm),
      gap:
        paceGap === null
          ? ''
          : paceGap <= 0
          ? `${-paceGap}초 단축`
          : `${paceGap}초 늘어남`,
      better: paceGap === null || paceGap <= 0,
    },
  ];
  return (
    <Card>
      <View style={styles.compareRow}>
        <AppText
          variant="heading"
          style={[styles.compareLabel, styles.cardHeading]}
        >
          {copy[period].compare}
        </AppText>
        <AppText
          variant="label"
          tone="textTertiary"
          style={styles.compareValue}
        >
          {previousLabel}
        </AppText>
        <AppText variant="labelStrong" style={styles.compareValue}>
          {currentLabel}
        </AppText>
        <View style={styles.compareGap} />
      </View>
      {rows.map(row => (
        <View key={row.label} style={styles.compareRow}>
          <AppText
            variant="caption"
            tone="textSecondary"
            style={styles.compareLabel}
          >
            {row.label}
          </AppText>
          <AppText
            variant="metricSmall"
            tone="textTertiary"
            style={styles.compareValue}
          >
            {row.before}
          </AppText>
          <AppText variant="metricSmall" style={styles.compareValue}>
            {row.now}
          </AppText>
          <AppText
            variant="labelStrong"
            style={[
              styles.compareGap,
              { color: row.better ? colors.accentText : colors.danger },
            ]}
          >
            {row.gap}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

// 5.3 러닝 분석: totals, distance by week, pace trend, heart rate zones and the period before.
export function AnalysisScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const [period, setPeriod] = useState<AnalysisPeriod>('MONTH');
  const [start, setStart] = useState(startOf('MONTH', today));
  const data = useResource(
    useCallback(
      (repositories: Repositories) =>
        Promise.all([
          repositories.records.getStatistics(period, start),
          repositories.records.getPaceTrend(6),
        ]) as Promise<[RunStatistics, PaceTrend]>,
      [period, start],
    ),
  );
  const isCurrent = start === startOf(period, today);
  const [statistics, trend] = data.status === 'ready' ? data.data : [];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={() => navigation.goBack()}
        />
        <AppText variant="title" accessibilityRole="header">
          러닝 분석
        </AppText>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.periodRow}>
          <PeriodStepper
            label={labelOf(period, start)}
            onPrevious={() => setStart(shift(period, start, -1))}
            onNext={
              isCurrent ? undefined : () => setStart(shift(period, start, 1))
            }
          />
          <Segmented
            compact
            options={periods}
            value={period}
            onChange={next => {
              setPeriod(next);
              setStart(startOf(next, today));
            }}
          />
        </View>
        {data.status === 'loading' ? (
          <ActivityIndicator style={styles.loading} />
        ) : data.status === 'error' || !statistics || !trend ? (
          <EmptyState
            icon="alert"
            title="분석을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={data.status === 'error' ? data.reload : undefined}
          />
        ) : (
          <>
            <SummaryGrid summary={statistics} />
            {statistics.runCount === 0 ? (
              <EmptyState
                title="이 기간에는 기록이 없어요"
                description="다른 기간을 골라 보세요."
              />
            ) : (
              <>
                <DistanceBars
                  period={period}
                  breakdown={statistics.breakdown}
                />
                <PaceTrendCard trend={trend} />
                <HeartZones shares={statistics.heartRateZones} />
              </>
            )}
            <Comparison
              period={period}
              start={start}
              current={statistics}
              previous={statistics.previousPeriod}
              isCurrent={isCurrent}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                period === 'MONTH' && isCurrent
                  ? '이번 달 기록 보기'
                  : '기록 보기'
              }
              onPress={() =>
                navigation.navigate('Records', {
                  month: (period === 'YEAR' && isCurrent ? today : start).slice(
                    0,
                    7,
                  ),
                })
              }
              style={({ pressed }) => [
                styles.link,
                {
                  backgroundColor: pressed
                    ? colors.border
                    : colors.surfaceMuted,
                },
              ]}
            >
              <AppText variant="bodyStrong">
                {period === 'MONTH' && isCurrent
                  ? '이번 달 기록 보기'
                  : '기록 보기'}
              </AppText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.screen,
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  loading: { marginTop: spacing.xxxl },
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.xxl,
    gap: spacing.xl,
  },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeading: { fontSize: 15 },
  summaryRow: { flexDirection: 'row' },
  summaryCell: { flex: 1, gap: spacing.xxs },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  barColumn: { flex: 1, alignItems: 'center', gap: spacing.sm },
  bar: { alignSelf: 'stretch', borderRadius: radius.sm, borderWidth: 1 },
  small: { fontSize: 9 },
  trend: { height: trendHeight },
  zoneBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 2,
  },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  zoneDot: { width: 8, height: 8, borderRadius: 2 },
  compareRow: { flexDirection: 'row', alignItems: 'center' },
  compareLabel: { flex: 1.4 },
  compareValue: { flex: 1, textAlign: 'right' },
  compareGap: { flex: 1.1, textAlign: 'right' },
  link: {
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
