import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native';
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native';
import { EmptyState } from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type RunRecordSummary,
} from '../../data';
import { navigateTo, openRecord } from '../../navigation/navigateTo';
import type { HomeStackParamList } from '../../navigation/types';
import { RecordsShell, RoundGlassButton, usePickerTop } from './look';
import { kstDay, kstMonth } from './parts';
import { CalendarPanel, WeekStrip } from './DatePicker';
import { DayRecords } from './DayRecords';

// The newest day with a run in a month (ALL), or null.
async function newestDayIn(repositories: Repositories, month: string) {
  const { records } = await repositories.records.getMonth(month, 'ALL');
  return records[0] ? kstDay(records[0].startedAt) : null;
}

// 5.1 내 기록 (runway-records): a week of days, then the chosen day's run on a glass card. A swipe across the
// week moves a week, and the calendar button opens the month calendar (S15P31E105-564). The card opens 5.2 (6.7
// for a group run).
export function RecordsScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, 'Records'>>();
  const pickerTop = usePickerTop();
  const { clock } = useRepositories();
  const today = kstDay(clock.now());
  const [day, setDay] = useState<string | null>(route.params?.day ?? null);
  const [runId, setRunId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  // Opened without a day: the newest day with a run (this month or the last), or today.
  const start = useResource(
    useCallback(
      async (repositories: Repositories) =>
        (await newestDayIn(repositories, kstMonth(today))) ??
        (await repositories.records.getRecent('recent', 1)).map(record =>
          kstDay(record.startedAt),
        )[0] ??
        today,
      [today],
    ),
  );
  const shown = day ?? (start.status === 'ready' ? start.data : null);
  const choose = (next: string) => {
    setDay(next);
    setRunId(null);
  };

  const open = (run: RunRecordSummary) => {
    if (run.runType === 'GROUP') {
      navigateTo(navigation, 'GroupRunResult');
    } else {
      openRecord(navigation, run.id);
    }
  };

  return (
    <RecordsShell
      title="내 기록"
      onBack={() =>
        navigation.canGoBack()
          ? navigation.goBack()
          : navigateTo(navigation, 'Home')
      }
      right={
        <RoundGlassButton
          icon="calendar"
          label="달력"
          onPress={() => setPicking(current => !current)}
        />
      }
      tabs={
        shown ? (
          <WeekStrip value={shown} today={today} onChange={choose} />
        ) : null
      }
      after={
        picking && shown ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="달력 닫기"
              onPress={() => setPicking(false)}
              style={styles.scrim}
            />
            <CalendarPanel
              value={shown}
              today={today}
              onPick={next => {
                setPicking(false);
                choose(next);
              }}
              style={{ ...styles.picker, top: pickerTop }}
            />
          </>
        ) : null
      }
    >
      <ScrollView
        contentContainerStyle={styles.card}
        showsVerticalScrollIndicator={false}
      >
        {start.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="기록을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={start.reload}
          />
        ) : !shown ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <DayRecords
            day={shown}
            runId={runId}
            onRun={setRunId}
            onOpen={open}
          />
        )}
      </ScrollView>
    </RecordsShell>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 22,
  },
  loading: { marginTop: 120 },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(9,17,26,0.18)',
  },
  picker: { position: 'absolute', left: 16, right: 16 },
});
