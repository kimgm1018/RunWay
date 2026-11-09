import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Icon, PressableScale } from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { fontFamily } from '../../theme';
import { AnalysisContent, loadPeriod } from '../records/AnalysisScreen';
import { DayRecords } from '../records/DayRecords';
import { recordsLook } from '../records/look';
import { kstDay, kstMonth, mondayOf } from '../records/parts';

// 2.1 홈의 러닝 기록 (S15P31E105-574, 담당자 수정사항): the chosen day's run on the card; a tap on it opens that run's
// detail (onOpen), not the month. The month's runs open from the plain '이 달 기록 전체 보기' button under the card,
// whether the day has a run or not, and a run there opens its detail too. Whether the month list is open lives in
// 홈, so it is still open when the user comes back from a detail.
export function RecordsPanel({
  day,
  runId,
  list,
  onRun,
  onList,
  onOpen,
}: {
  day: string;
  runId: string | null;
  // The month list instead of the day's card.
  list: boolean;
  onRun: (id: string) => void;
  onList: (open: boolean) => void;
  onOpen: (run: RunRecordSummary) => void;
}) {
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const month = useResource(
    useCallback(
      (repositories: Repositories) =>
        loadPeriod(
          repositories,
          'MONTH',
          {
            week: mondayOf(day),
            month: kstMonth(day),
            year: Number(day.slice(0, 4)),
          },
          today,
        ),
      [day, today],
    ),
  );
  const refresh = month.refresh;
  useEffect(
    () =>
      onRecordsChanged(() => {
        void refresh();
      }),
    [refresh],
  );

  if (list) {
    return (
      <AnalysisContent
        data={month}
        mode="MONTH"
        appearKey={`MONTH:${kstMonth(day)}`}
        view="list"
        onFlip={() => onList(false)}
        backLabel="하루 기록으로 보기"
        onSwipe={() => undefined}
        onOpen={onOpen}
      />
    );
  }
  return (
    <View>
      <DayRecords day={day} runId={runId} onRun={onRun} onOpen={onOpen} />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="이 달 기록 전체 보기"
        hitSlop={6}
        onPress={() => onList(true)}
        style={styles.monthButton}
      >
        <Icon
          name="calendar"
          color={recordsLook.onCard}
          size={15}
          strokeWidth={2}
        />
        <AppText style={styles.monthText}>이 달 기록 전체 보기</AppText>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  // A plain pill under the card, as the empty day's old link was.
  monthButton: {
    alignSelf: 'center',
    marginTop: 18,
    height: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  monthText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    color: recordsLook.onCard,
  },
});
