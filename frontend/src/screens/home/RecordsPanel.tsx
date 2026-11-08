import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { onRecordsChanged } from '../../data/recordsChanged';
import { AnalysisContent, loadPeriod } from '../records/AnalysisScreen';
import { DayRecords } from '../records/DayRecords';
import { kstDay, kstMonth, mondayOf } from '../records/parts';

// 2.1 홈의 과거 러닝 기록 (S15P31E105-564, 담당자 결정): the day's run on the front; a tap on it turns the card over
// to the month's runs (5.3's card back: 10월 기록 · 7번 · 34.2km, then each run), and ↻ turns it back. A run on the
// back opens in 기록 상세 on its day.
export function RecordsPanel({
  day,
  runId,
  onRun,
  onOpen,
}: {
  day: string;
  runId: string | null;
  onRun: (id: string) => void;
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

  // A quarter turn away, the other face swapped in while the card stands on its edge, a quarter turn back (5.3).
  const [back, setBack] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const flipping = useRef(false);
  const flip = () => {
    if (flipping.current) {
      return;
    }
    flipping.current = true;
    Animated.timing(turn, {
      toValue: 1,
      duration: 180,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      setBack(current => !current);
      turn.setValue(-1);
      Animated.timing(turn, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        flipping.current = false;
      });
    });
  };

  return (
    <Animated.View
      style={{
        transform: [
          { perspective: 1200 },
          {
            rotateY: turn.interpolate({
              inputRange: [-1, 0, 1],
              outputRange: ['-90deg', '0deg', '90deg'],
            }),
          },
        ],
      }}
    >
      {back ? (
        <AnalysisContent
          data={month}
          mode="MONTH"
          appearKey={`MONTH:${kstMonth(day)}`}
          view="list"
          onFlip={flip}
          backLabel="기록 카드로 보기"
          onSwipe={() => undefined}
          onOpen={onOpen}
        />
      ) : (
        <DayRecords
          day={day}
          runId={runId}
          onRun={onRun}
          onOpen={flip}
          onList={flip}
        />
      )}
    </Animated.View>
  );
}
