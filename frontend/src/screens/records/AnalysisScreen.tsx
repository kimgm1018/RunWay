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
import Svg, { Circle, Line, Polyline, Text } from 'react-native-svg';
import {
  AppText,
  Backdrop,
  Card as KitCard,
  EmptyState,
  IconButton,
  Segmented,
} from '../../components';
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
  size,
  spacing,
  ThemeProvider,
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

// Every 5.3 box is the dark glass card; the totals use the vignette (DESIGN.md 2-8 5.3).
function Card({
  title,
  note,
  vignette = false,
  children,
}: {
  title?: string;
  note?: string;
  vignette?: boolean;
  children: React.ReactNode;
}) {
  return (
    <KitCard variant={vignette ? 'vignette' : 'deep'} style={styles.card}>
      {title ? (
        <View style={styles.cardTitle}>
          <AppText variant="heading" style={styles.cardHeading}>
            {title}
          </AppText>
          {note ? (
            <AppText variant="label" tone="textSecondary">
              {note}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {children}
    </KitCard>
  );
}

// A 14% line inside a card, read in the card's dark tone.
function Rule({ vertical = false }: { vertical?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        vertical ? styles.ruleVertical : styles.rule,
        { backgroundColor: colors.border },
      ]}
    />
  );
}

function SummaryGrid({ summary }: { summary: PeriodSummary }) {
  const cell = (value: string, unit: string, label: string) => (
    <View style={styles.summaryCell}>
      <AppText style={styles.summaryValue}>
        {value}
        <AppText variant="label" tone="textSecondary">
          {unit}
        </AppText>
      </AppText>
      <AppText variant="labelStrong" tone="textSecondary">
        {label}
      </AppText>
    </View>
  );
  // 2 × 2 split by 14% lines, like the 4.5 metrics (DESIGN.md 2-8 5.3 요약).
  return (
    <Card vignette>
      <View style={styles.summaryRow}>
        {cell(String(summary.runCount), '회', '러닝')}
        <Rule vertical />
        {cell(formatKm(summary.totalDistanceM, 1), 'km', '누적 거리')}
      </View>
      <Rule />
      <View style={styles.summaryRow}>
        {cell(
          summary.averagePaceSecPerKm === null
            ? '– –'
            : formatPace(summary.averagePaceSecPerKm),
          '',
          '평균 페이스',
        )}
        <Rule vertical />
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
                tone={highlighted ? 'text' : 'textSecondary'}
                style={[styles.barValue, period === 'YEAR' && styles.small]}
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
                    // The longest bar is white; the rest are the faint white of the dark tone (DESIGN.md 2-8 주별 거리).
                    backgroundColor: highlighted
                      ? colors.accent
                      : colors.accentSoft,
                  },
                ]}
              />
              <AppText variant="label" tone="textSecondary">
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
            {[0, 0.5, 1].map(share => (
              <Line
                key={share}
                x1={0}
                x2={width}
                y1={12 + share * (trendHeight - 34)}
                y2={12 + share * (trendHeight - 34)}
                stroke={colors.border}
                strokeWidth={1}
              />
            ))}
            <Polyline
              points={points.map(point => `${point.x},${point.y}`).join(' ')}
              stroke={colors.accentText}
              strokeWidth={1.8}
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
                  r={latest ? 4.5 : 0}
                  fill={palette.white}
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
                  fill={latest ? colors.text : colors.textSecondary}
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
          <AppText variant="captionStrong">
            {change < 0 ? `${-change}초 빨라졌어요` : `${change}초 느려졌어요`}
          </AppText>
        </AppText>
      ) : null}
    </Card>
  );
}

// Zones 1–5 in white at 20 · 42 · 62 · 82 · 100% (DESIGN.md 2-8 심박 구간).
const zones = [
  { name: '회복', color: 'rgba(232,238,244,0.2)' },
  { name: '유산소', color: 'rgba(232,238,244,0.42)' },
  { name: '템포', color: 'rgba(232,238,244,0.62)' },
  { name: '역치', color: 'rgba(232,238,244,0.82)' },
  { name: '최대', color: '#E8EEF4' },
];

function HeartZones({ shares }: { shares: number[] }) {
  return (
    <Card title="심박 구간">
      {shares.length === 0 ? (
        <AppText variant="caption" tone="textSecondary">
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
              <AppText style={styles.zoneShare}>{`${Math.round(
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
          tone="textSecondary"
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
          {/* The difference is bold white either way (DESIGN.md 2-8 지난달과 비교). */}
          <AppText variant="labelStrong" style={styles.compareGap}>
            {row.gap}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

// The outlined link's border and text, read in the dark tone.
function LinkLabel({ title }: { title: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.linkInner, { borderColor: colors.borderStrong }]}>
      <AppText variant="bodyStrong">{title}</AppText>
    </View>
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
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <View style={styles.header}>
        <IconButton
          icon="back"
          accessibilityLabel="뒤로"
          onPress={() => navigation.goBack()}
        />
        <AppText style={styles.title} accessibilityRole="header">
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
              // The charts pick their colors before the card is drawn, so they read the
              // card's dark tone from here.
              <ThemeProvider tone="dark">
                <DistanceBars
                  period={period}
                  breakdown={statistics.breakdown}
                />
                <PaceTrendCard trend={trend} />
                <HeartZones shares={statistics.heartRateZones} />
              </ThemeProvider>
            )}
            <Comparison
              period={period}
              start={start}
              current={statistics}
              previous={statistics.previousPeriod}
              isCurrent={isCurrent}
            />
            {/* It ends the scroll on the black lower part: an outlined pill (DESIGN.md 2-8 5.3 버튼). */}
            <ThemeProvider tone="dark">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  period === 'MONTH' && isCurrent
                    ? '이번 달 기록 보기'
                    : '기록 보기'
                }
                onPress={() =>
                  navigation.navigate('Records', {
                    month: (period === 'YEAR' && isCurrent
                      ? today
                      : start
                    ).slice(0, 7),
                  })
                }
                style={({ pressed }) => [
                  styles.link,
                  pressed && styles.pressed,
                ]}
              >
                <LinkLabel
                  title={
                    period === 'MONTH' && isCurrent
                      ? '이번 달 기록 보기'
                      : '기록 보기'
                  }
                />
              </Pressable>
            </ThemeProvider>
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
  title: { fontFamily: fontFamily.medium, fontSize: 22, lineHeight: 30 },
  content: {
    paddingHorizontal: 14,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  loading: { marginTop: spacing.xxxl },
  card: { gap: spacing.xl },
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardHeading: { fontSize: 15, fontFamily: fontFamily.medium },
  rule: { height: 1 },
  ruleVertical: { width: 1, alignSelf: 'stretch' },
  summaryRow: { flexDirection: 'row' },
  summaryCell: { flex: 1, alignItems: 'center', gap: 2 },
  // Big numbers stay Barlow Regular at the sheet's 30.
  summaryValue: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 30,
    lineHeight: 36,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  barColumn: { flex: 1, alignItems: 'center', gap: spacing.sm },
  bar: { alignSelf: 'stretch', borderRadius: 14 },
  barValue: { fontFamily: fontFamily.numberMedium, fontSize: 14 },
  small: { fontSize: 9 },
  trend: { height: trendHeight },
  zoneBar: {
    flexDirection: 'row',
    height: 12,
    borderRadius: 6,
    overflow: 'hidden',
    gap: 3,
  },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  zoneDot: { width: 9, height: 9, borderRadius: 2 },
  zoneShare: { fontFamily: fontFamily.numberMedium, fontSize: 14 },
  compareRow: { flexDirection: 'row', alignItems: 'center' },
  compareLabel: { flex: 1.4 },
  compareValue: { flex: 1, textAlign: 'right' },
  compareGap: { flex: 1.1, textAlign: 'right' },
  link: { marginTop: spacing.md },
  linkInner: {
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
});
