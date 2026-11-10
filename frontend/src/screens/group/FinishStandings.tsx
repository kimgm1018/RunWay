import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';
import { AppText } from '../../components';
import type { GroupRunResult } from '../../data';
import { formatDuration, formatKm } from '../../format';
import { fontFamily } from '../../theme';
import { MixedFigure, resultLook, resultType } from '../run/resultLook';

type Runner = GroupRunResult['participants'][number];

// 6.7 완주 현황 as a race standings board (S15P31E105-661 담당자 레퍼런스: 모터스포츠 순위표): the big FINISH STATUS
// title, a POS · RUNNER · TIME head, and one row a runner. A runner who reached the goal (완주, as counted above the
// list) gets an outlined place (01, 02 …) in list order; anyone else gets a short Korean word in its place (미달성,
// 진행 중, 중단, 미시작, 미확인; 담당자 요청: 영문 약어 대신 한국어). A thin bar before the name tells the state, and
// my row is lit in mint like the highlighted row of a standings board.

const posWidth = 58;
const posHeight = 34;

// The place drawn as outlined figures (react-native-svg, since Text has no stroke). Archivo has no Korean letters,
// so a word in the place column is plain Noto Sans KR instead.
function Place({ text, color }: { text: string; color: string }) {
  if (!/^\d+$/.test(text)) {
    return (
      <AppText style={[styles.placeWord, { color }]} numberOfLines={1}>
        {text}
      </AppText>
    );
  }
  const size = 26;
  return (
    <Svg
      width={posWidth}
      height={posHeight}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <SvgText
        x={0}
        y={posHeight / 2 + size * 0.36}
        fontFamily={fontFamily.resultBlack}
        fontSize={size}
        fill="none"
        stroke={color}
        strokeWidth={1.1}
      >
        {text}
      </SvgText>
    </Svg>
  );
}

function placeOf(runner: Runner, finishPlace: number | null) {
  if (finishPlace !== null) {
    return String(finishPlace).padStart(2, '0');
  }
  switch (runner.state) {
    case 'FINISHED':
      return '미달성';
    case 'RUNNING':
      return '진행 중';
    case 'STOPPED':
      return '중단';
    case 'NOT_STARTED':
      return '미시작';
    default:
      return '미확인';
  }
}

function barColor(runner: Runner) {
  if (runner.state === 'FINISHED') {
    return runner.goalAchieved ? resultLook.mint : resultLook.outline;
  }
  if (runner.state === 'RUNNING') {
    return resultLook.route;
  }
  if (runner.state === 'STOPPED') {
    return resultLook.danger;
  }
  return 'rgba(255,255,255,0.2)';
}

// The small line under the name (PTS on the board): what the runner's state means in words.
function statusOf(runner: Runner) {
  switch (runner.state) {
    case 'FINISHED':
      return runner.goalAchieved ? '목표 완주' : '목표 미달성';
    case 'RUNNING':
      return '달리는 중';
    case 'STOPPED':
      // Only an interrupted session is "중단". Missing the goal after finishing
      // still leaves a normal finish record (S15P31E105-637).
      return runner.distanceM === null
        ? '중단 · 거리 미확인'
        : `${formatKm(runner.distanceM, 1)}km에서 중단`;
    case 'UNCONFIRMED':
      return '시작 미확인';
    default:
      return '미시작';
  }
}

export function FinishStandings({ rows }: { rows: Runner[] }) {
  let place = 0;
  return (
    <View>
      <AppText style={resultType.label} accessibilityRole="header">
        완주 현황
      </AppText>
      <AppText style={styles.title}>FINISH STATUS</AppText>
      <View style={styles.head}>
        <AppText style={[styles.headText, styles.headPos]}>POS</AppText>
        <AppText style={[styles.headText, styles.flex]}>RUNNER</AppText>
        <AppText style={styles.headText}>TIME</AppText>
      </View>
      {rows.map(runner => {
        const finishPlace =
          runner.state === 'FINISHED' && runner.goalAchieved
            ? (place += 1)
            : null;
        const lit = runner.isMe;
        const active = runner.state === 'FINISHED';
        const time =
          runner.durationSec !== null &&
          (runner.state === 'FINISHED' || runner.state === 'STOPPED')
            ? formatDuration(runner.durationSec)
            : '– –';
        return (
          <View key={runner.userId} style={[styles.row, lit && styles.rowLit]}>
            <Place
              text={placeOf(runner, finishPlace)}
              color={
                lit
                  ? resultLook.mint
                  : finishPlace !== null
                  ? resultLook.text
                  : resultLook.sub
              }
            />
            <View style={[styles.bar, { backgroundColor: barColor(runner) }]} />
            <View style={styles.who}>
              <View style={styles.nameLine}>
                <AppText
                  style={[styles.name, !active && styles.nameQuiet]}
                  numberOfLines={1}
                >
                  {runner.nickname}
                </AppText>
                {runner.isMe ? (
                  <View style={styles.meBadge}>
                    <AppText style={styles.meText}>나</AppText>
                  </View>
                ) : null}
              </View>
              <MixedFigure
                text={statusOf(runner)}
                style={[
                  styles.status,
                  runner.state === 'FINISHED' &&
                    runner.goalAchieved &&
                    styles.statusMint,
                ]}
                numberStyle={styles.statusNumber}
              />
            </View>
            <AppText
              style={[styles.time, !active && styles.timeQuiet]}
              numberOfLines={1}
            >
              {time}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // STANDINGS on the board: the section's name in Latin, big and wide.
  title: {
    marginTop: 2,
    fontFamily: fontFamily.resultBlack,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: resultLook.text,
  },
  head: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: resultLook.divider,
  },
  headText: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 2,
    color: resultLook.sub,
  },
  headPos: { width: posWidth + 16 },
  placeWord: {
    width: posWidth,
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 62,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: resultLook.line,
  },
  // My row lit in mint, as the highlighted row of a standings board.
  rowLit: {
    marginHorizontal: -10,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(77,255,210,0.1)',
    borderBottomColor: 'rgba(77,255,210,0.5)',
  },
  bar: { width: 4, height: 30, marginLeft: 6, marginRight: 12 },
  who: { flex: 1, minWidth: 0, gap: 1 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: {
    flexShrink: 1,
    fontFamily: fontFamily.black,
    fontSize: 18,
    lineHeight: 24,
    color: resultLook.text,
  },
  nameQuiet: { color: resultLook.sub },
  meBadge: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 4,
    justifyContent: 'center',
    backgroundColor: resultLook.mint,
  },
  meText: {
    fontFamily: fontFamily.bold,
    fontSize: 11,
    lineHeight: 14,
    color: resultLook.ink,
  },
  status: { fontSize: 12, lineHeight: 17, color: resultLook.sub },
  statusMint: { color: resultLook.mint },
  statusNumber: { fontSize: 12.5, color: resultLook.sub },
  time: {
    marginLeft: 10,
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 20,
    lineHeight: 26,
    color: resultLook.text,
  },
  timeQuiet: { color: resultLook.sub },
});
