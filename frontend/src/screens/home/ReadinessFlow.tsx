import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { AppText, Icon, WordWrap } from '../../components';
import { useResource, type Repositories, type TrainingLoad } from '../../data';
import { weeklyLoadLabel } from '../../data/api/readiness';
import { fontFamily } from '../../theme';
import { recordsLook } from '../records/look';
import { addDays, kstDay } from '../records/parts';

// 2.1 준비도 리포트 (S15P31E105-594, 담당자 시안 "오늘의 준비도"): the score on a ring, the load against the usual week
// with its days, and why the score is what it is (S·R·L, readiness-formula 1~6절). Colours stay the card's own
// (white on the navy card; 담당자: 디자인·색상은 그대로, 구성만), mint as the one accent (담당자 결정, the feed's route
// colour). Every number is the
// server's (R02); nothing here recomputes a score. The days and the item scores show once R02 sends them.

export const accent = recordsLook.mint;

// 72.5 → '72.5', 93 → '93'.
export const scoreText = (value: number) => String(Number(value.toFixed(2)));

const monthDay = (day: string) => {
  const [, month, date] = day.split('-').map(Number);
  return { month, date };
};

const dotted = (day: string) => {
  const { month, date } = monthDay(day);
  return `${String(month).padStart(2, '0')}.${String(date).padStart(2, '0')}`;
};

// The score on a ring, 100 the full turn.
export function ScoreRing({
  score,
  counted,
}: {
  score: number | null;
  counted: number;
}) {
  const size = 118;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const share = score === null ? 0 : Math.max(0, Math.min(100, counted)) / 100;
  return (
    <View
      style={[styles.ring, { width: size, height: size }]}
      accessibilityLabel={`준비도 ${score ?? '없음'}`}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgba(255,255,255,0.22)"
          strokeWidth={stroke}
          fill="none"
        />
        {score === null ? null : (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${length * share} ${length}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <AppText style={styles.ringScore}>
        {score === null ? '--' : String(counted)}
        <AppText style={styles.ringUnit}>{score === null ? '' : '점'}</AppText>
      </AppText>
      <AppText style={styles.ringBase}>100점 기준</AppText>
    </View>
  );
}

// "최근 7일 운동량이 평소보다 50% 많아 운동량 항목에 반영됐어요." Only with a usual week to compare with.
// S15P31E105-660 사용자 결정: the same bands as the sentence above (weeklyLoadLabel, ratio 0.8~1.2 = 비슷), so a
// small difference reads 평소와 비슷해 rather than "3% 많아"; outside them the percent. "운동량 항목에 반영됐어요" only
// when the score really used the load item (loadScore), never for a day the formula left it out.
export function LoadNotice({
  load,
  loadScored,
}: {
  load: TrainingLoad;
  loadScored: boolean;
}) {
  if (load.usual === null || !(load.usual > 0)) {
    return null;
  }
  const change = Math.round((load.weekly / load.usual - 1) * 100);
  const similar = weeklyLoadLabel(load.weekly, load.usual) === '평소와 비슷';
  const lead = similar ? '최근 7일 운동량이 ' : '최근 7일 운동량이 평소보다 ';
  const word = similar
    ? '평소와 비슷해'
    : change > 0
    ? `${change}% 많아`
    : `${-change}% 적어`;
  return (
    <View style={styles.notice}>
      <Icon name="activity" color={recordsLook.onCard} size={18} />
      <View style={styles.noticeBody}>
        <AppText style={styles.noticeText}>
          {lead}
          <AppText style={styles.noticeStrong}>{word}</AppText>
          {loadScored ? '' : '요.'}
        </AppText>
        {loadScored ? (
          <AppText style={styles.noticeText}>운동량 항목에 반영됐어요.</AppText>
        ) : null}
      </View>
    </View>
  );
}

// The runs by day, so a day without load but with a run reads 심박 없음, not 휴식.
const loadRecent = (repositories: Repositories) =>
  repositories.records.getRecent('recent', 20);

type DayKind = 'load' | 'rest' | 'noHeart';
type LoadDay = { date: string; load: number | null };

// 최근 러닝: the 7 days' load as bars (when R02 sends them), the week against the usual one, and what 부하 is.
export function LoadCard({
  day,
  isToday,
  load,
  reason,
}: {
  // The score's day (D); the week is D-6~D.
  day: string;
  isToday: boolean;
  load: TrainingLoad | null;
  // Why there is no load, when there is none.
  reason: string | null;
}) {
  const recent = useResource(loadRecent);
  const [picked, setPicked] = useState<string | null>(null);
  const [explain, setExplain] = useState(false);
  const runsOn = (date: string) =>
    recent.status === 'ready'
      ? recent.data.filter(run => kstDay(run.startedAt) === date).length
      : 0;
  // The bars are this score's week only: a list ending on another day is left out rather than drawn under it.
  const days =
    load?.days && load.days[load.days.length - 1]?.date === day
      ? load.days
      : null;
  const drawn = days !== null && days.some(item => item.load !== null);
  const kindOf = (item: LoadDay): DayKind =>
    item.load !== null ? 'load' : runsOn(item.date) > 0 ? 'noHeart' : 'rest';
  const change =
    load && load.usual !== null && load.usual > 0
      ? Math.round((load.weekly / load.usual - 1) * 100)
      : null;
  const selected =
    drawn && days
      ? days.find(item => item.date === picked) ?? days[days.length - 1]
      : null;
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <AppText style={styles.panelTitle}>최근 러닝</AppText>
        {change !== null ? (
          <View style={styles.badge}>
            <Icon name="trend" color={recordsLook.onCard} size={14} />
            <AppText style={styles.badgeText}>
              {change > 0
                ? `${change}% 증가`
                : change < 0
                ? `${-change}% 감소`
                : '평소와 같음'}
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText style={styles.panelSub}>
        {`${dotted(addDays(day, -6))} – ${dotted(day)} · ${
          drawn ? '날짜별 운동 부하' : '최근 7일 운동 부하'
        }`}
      </AppText>

      {load === null ? (
        <AppText style={styles.empty}>{reason ?? '– –'}</AppText>
      ) : (
        <>
          {drawn && days ? (
            <DayBars
              days={days}
              kindOf={kindOf}
              isToday={isToday}
              today={day}
              selected={selected?.date ?? null}
              onPick={setPicked}
            />
          ) : null}
          {selected ? (
            <AppText style={styles.dayLine}>
              {dayLine(selected, kindOf(selected), runsOn(selected.date))}
            </AppText>
          ) : null}
          <View style={styles.divider} />
          <Compare label="최근 7일" value={load.weekly} load={load} strong />
          <Compare label="평소" value={load.usual} load={load} />
        </>
      )}

      <View style={styles.panelFoot}>
        <AppText style={styles.footText}>평소 = 최근 28일의 주간 평균</AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="부하란?"
          accessibilityState={{ expanded: explain }}
          hitSlop={8}
          onPress={() => setExplain(open => !open)}
        >
          <AppText style={styles.footLink}>부하란?</AppText>
        </Pressable>
      </View>
      {explain ? (
        <View style={styles.explain}>
          <WordWrap
            text="부하는 운동한 시간에 심박 구간을 곱해 더한 운동량이에요. 같은 시간이라도 심박이 높은 구간에서 오래 달릴수록 커져요."
            style={styles.footText}
            fontSize={12}
          />
        </View>
      ) : null}
    </View>
  );
}

function dayLine(item: LoadDay, kind: DayKind, runs: number) {
  const { month, date } = monthDay(item.date);
  const head = `${month}월 ${date}일`;
  if (kind === 'rest') {
    return `${head} · 휴식 기록 · 운동 부하 0`;
  }
  if (kind === 'noHeart') {
    return `${head} · 러닝 ${runs}회 · 심박 기록이 없어 부하에 들어가지 않았어요`;
  }
  return `${head} · ${
    runs > 0 ? `러닝 ${runs}회` : '운동 기록'
  } · 운동 부하 ${Math.round(item.load!)}`;
}

const plotHeight = 112;
const labelSpace = 20;

// A round top for the axis: 200 for 180, 100 for 70.
const axisTop = (max: number) =>
  max <= 50 ? 50 : max <= 100 ? 100 : Math.ceil(max / 100) * 100;

function DayBars({
  days,
  kindOf,
  isToday,
  today,
  selected,
  onPick,
}: {
  days: LoadDay[];
  kindOf: (item: LoadDay) => DayKind;
  isToday: boolean;
  today: string;
  selected: string | null;
  onPick: (date: string) => void;
}) {
  const top = axisTop(Math.max(...days.map(item => item.load ?? 0)));
  const ticks = [top, top / 2, 0];
  const lineAt = (tick: number) => labelSpace + plotHeight * (1 - tick / top);
  return (
    <View style={styles.chart}>
      <View style={styles.axis}>
        {ticks.map(tick => (
          <AppText
            key={tick}
            style={[styles.axisText, { top: lineAt(tick) - 8 }]}
            numberOfLines={1}
          >
            {String(tick)}
          </AppText>
        ))}
      </View>
      <View style={styles.plotWrap}>
        <View style={styles.plot}>
          {ticks.map(tick => (
            <View key={tick} style={[styles.grid, { top: lineAt(tick) }]} />
          ))}
          {days.map(item => {
            const kind = kindOf(item);
            const on = item.date === selected;
            return (
              <Pressable
                key={item.date}
                accessibilityRole="button"
                accessibilityLabel={`${monthDay(item.date).date}일 운동 부하`}
                accessibilityState={{ selected: on }}
                onPress={() => onPick(item.date)}
                style={styles.column}
              >
                <AppText
                  style={[styles.barLabel, kind !== 'load' && styles.barNote]}
                  numberOfLines={1}
                >
                  {kind === 'load'
                    ? String(Math.round(item.load!))
                    : kind === 'rest'
                    ? '휴식'
                    : '심박 없음'}
                </AppText>
                {kind === 'load' ? (
                  <View
                    style={[
                      styles.bar,
                      {
                        height: Math.max(
                          3,
                          (plotHeight * (item.load ?? 0)) / top,
                        ),
                      },
                      on && styles.barOn,
                    ]}
                  />
                ) : (
                  <View
                    style={[styles.stub, kind === 'noHeart' && styles.stubDash]}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
        <View style={styles.xAxis}>
          {days.map(item => (
            <AppText
              key={item.date}
              style={[styles.xText, item.date === selected && styles.xTextOn]}
            >
              {isToday && item.date === today
                ? '오늘'
                : `${monthDay(item.date).date}일`}
            </AppText>
          ))}
        </View>
      </View>
    </View>
  );
}

function Compare({
  label,
  value,
  load,
  strong = false,
}: {
  label: string;
  value: number | null;
  load: TrainingLoad;
  strong?: boolean;
}) {
  const top = Math.max(load.weekly, load.usual ?? 0, 1);
  return (
    <View style={styles.compare}>
      <AppText style={styles.compareLabel}>{label}</AppText>
      <View style={styles.compareTrack}>
        {value === null ? null : (
          <View
            style={[
              styles.compareFill,
              { width: `${(value / top) * 100}%` },
              strong ? styles.compareStrong : null,
            ]}
          />
        )}
      </View>
      <AppText style={styles.compareValue}>
        {value === null ? '기록 없음' : String(Math.round(value))}
      </AppText>
    </View>
  );
}

// readiness-formula 6-1절: the most a score can be, by its lowest item.
const capOf = (lowest: number) =>
  lowest >= 70 ? 100 : lowest >= 50 ? 84 : lowest >= 30 ? 69 : 49;

export type ReasonRow = {
  name: string;
  // The item's score, when R02 sends it.
  score: number | null;
  // Next to the name: what the score stands on (최근 3일 반영, 평소 대비 +6.7%, 평소의 1.5배).
  detail: string | null;
  // Without a score: the record itself (7h 12m, 58회/분) and why one is missing.
  value: string;
  note: string | null;
};

// 왜 N점인가요?: each item's score on a bar (the lowest in the accent), then their average and the score.
export function ScoreReasons({
  score,
  title,
  rows,
}: {
  score: number | null;
  title: string;
  rows: ReasonRow[];
}) {
  const [open, setOpen] = useState(true);
  const scored = rows.filter(row => row.score !== null);
  const lowest = scored.length
    ? Math.min(...scored.map(row => row.score!))
    : null;
  const average = scored.length
    ? scored.reduce((sum, row) => sum + row.score!, 0) / scored.length
    : null;
  const capped =
    score !== null &&
    average !== null &&
    lowest !== null &&
    Math.round(average) > score &&
    score === capOf(lowest);
  const count = ['', '한', '두', '세'][scored.length] ?? String(scored.length);
  return (
    <View style={styles.reasons}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        style={styles.reasonsHead}
      >
        <AppText style={styles.panelTitle}>{title}</AppText>
        <View style={open ? styles.chevronOpen : null}>
          <Icon
            name="chevronDown"
            color={recordsLook.onCard}
            size={20}
            strokeWidth={2.2}
          />
        </View>
      </Pressable>
      {open ? (
        <>
          {rows.map(row => (
            <View key={row.name} style={styles.reason}>
              <View style={styles.reasonHead}>
                <AppText style={styles.reasonName} numberOfLines={1}>
                  {row.score !== null && row.detail
                    ? `${row.name} · ${row.detail}`
                    : row.name}
                </AppText>
                <AppText style={styles.reasonScore}>
                  {row.score !== null ? `${scoreText(row.score)}점` : row.value}
                </AppText>
              </View>
              {row.score !== null ? (
                <View style={styles.reasonTrack}>
                  <View
                    style={[
                      styles.reasonFill,
                      { width: `${Math.max(0, Math.min(100, row.score))}%` },
                      scored.length > 1 &&
                        row.score === lowest &&
                        styles.reasonLowest,
                    ]}
                  />
                </View>
              ) : row.note ? (
                <AppText style={styles.reasonNote}>{row.note}</AppText>
              ) : null}
            </View>
          ))}
          {/* The average only with the item scores behind it; the ring already shows the score alone. */}
          {score === null || average === null ? null : (
            <>
              <View style={styles.divider} />
              <View style={styles.total}>
                <AppText style={styles.totalLabel}>
                  {capped
                    ? '가장 낮은 항목 기준 상한'
                    : scored.length === 1
                    ? '한 항목의 점수'
                    : `${count} 항목의 평균`}
                </AppText>
                <AppText style={styles.totalScore}>{`${score}점`}</AppText>
              </View>
              {capped ? (
                <AppText style={styles.totalNote}>
                  {`가장 낮은 항목이 ${scoreText(
                    lowest!,
                  )}점이라 평균 ${scoreText(
                    average,
                  )}점 대신 최대 ${score}점이에요.`}
                </AppText>
              ) : scoreText(average) !== String(score) ? (
                <AppText style={styles.totalNote}>
                  {`평균 ${scoreText(average)}점을 반올림했어요.`}
                </AppText>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { alignItems: 'center', justifyContent: 'center' },
  ringScore: {
    fontFamily: fontFamily.bold,
    fontSize: 42,
    lineHeight: 48,
    letterSpacing: -1.4,
    color: recordsLook.onCard,
    includeFontPadding: false,
  },
  ringUnit: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    letterSpacing: 0,
    color: recordsLook.onCard,
  },
  ringBase: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: recordsLook.onCardMuted,
  },
  notice: {
    marginTop: 18,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  noticeBody: { flex: 1 },
  noticeText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 20,
    color: recordsLook.onCardLabel,
  },
  noticeStrong: { fontFamily: fontFamily.bold, color: accent },
  panel: {
    marginTop: 14,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  panelHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panelTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 24,
    color: recordsLook.onCard,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  badgeText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 17,
    color: recordsLook.onCard,
  },
  panelSub: {
    marginTop: 4,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardMuted,
  },
  empty: {
    marginTop: 12,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardSub,
  },
  chart: { marginTop: 10, flexDirection: 'row' },
  // Wide enough for 200 in Archivo (S15P31E105-662), which sets figures wider than Noto Sans KR did.
  axis: { width: 36 },
  axisText: {
    position: 'absolute',
    left: 0,
    fontFamily: fontFamily.medium,
    fontSize: 10.5,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
  plotWrap: { flex: 1 },
  plot: {
    height: labelSpace + plotHeight,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  grid: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: recordsLook.onCardLine,
  },
  column: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barLabel: {
    marginBottom: 4,
    fontFamily: fontFamily.medium,
    fontSize: 11,
    lineHeight: 14,
    color: recordsLook.onCardSub,
  },
  barNote: { fontSize: 10.5, color: recordsLook.onCardMuted },
  bar: {
    width: 22,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: accent,
    opacity: 0.78,
  },
  barOn: { opacity: 1 },
  stub: {
    width: 22,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  stubDash: {
    height: 10,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.55)',
  },
  xAxis: { flexDirection: 'row', marginTop: 8 },
  xText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 16,
    color: recordsLook.onCardMuted,
  },
  xTextOn: { fontFamily: fontFamily.bold, color: recordsLook.onCard },
  dayLine: {
    marginTop: 12,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardSub,
  },
  divider: {
    marginVertical: 14,
    height: StyleSheet.hairlineWidth,
    backgroundColor: recordsLook.onCardLine,
  },
  compare: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  compareLabel: {
    width: 52,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: recordsLook.onCardLabel,
  },
  compareTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  compareFill: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  compareStrong: { backgroundColor: accent },
  compareValue: {
    minWidth: 40,
    textAlign: 'right',
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCard,
  },
  panelFoot: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  footText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardMuted,
  },
  footLink: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardSub,
    textDecorationLine: 'underline',
  },
  explain: { marginTop: 8 },
  reasons: { marginTop: 22 },
  reasonsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  reason: { marginTop: 12 },
  reasonHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: 12,
  },
  reasonName: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 19,
    color: recordsLook.onCardLabel,
  },
  reasonScore: {
    fontFamily: fontFamily.bold,
    fontSize: 14.5,
    lineHeight: 20,
    color: recordsLook.onCard,
  },
  reasonTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  reasonFill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
  reasonLowest: { backgroundColor: accent },
  reasonNote: {
    marginTop: 2,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardMuted,
  },
  total: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 20,
    color: recordsLook.onCardLabel,
  },
  totalScore: {
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    color: recordsLook.onCard,
  },
  totalNote: {
    marginTop: 6,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 17,
    color: recordsLook.onCardMuted,
  },
});
