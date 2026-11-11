import React from 'react';
import { useNavigation } from '@react-navigation/native';
import type { RunRecordSummary } from '../../data';
import { openRunTab } from '../../navigation/navigateTo';
import { DayRecords } from '../records/DayRecords';

// 2.1 홈의 러닝 분석 (S15P31E105-615, 담당자 요청: 페이스·심박 카드를 러닝 분석에, 이전 하루 요약은 없앰): the chosen
// day's run as 최근 러닝, its pace and heart rate in one plot by km and its figures under it. A run opens its detail
// (onOpen); a day without one can show the month's runs on 러닝 기록 (onShowList).
export function AnalysisPanel({
  day,
  runId,
  onRun,
  onOpen,
  onShowList,
}: {
  day: string;
  runId: string | null;
  onRun: (id: string) => void;
  onOpen: (run: RunRecordSummary) => void;
  onShowList: () => void;
}) {
  const navigation = useNavigation();
  return (
    <DayRecords
      day={day}
      runId={runId}
      onRun={onRun}
      onOpen={onOpen}
      onList={onShowList}
      home
      onStartRun={() => openRunTab(navigation)}
    />
  );
}
