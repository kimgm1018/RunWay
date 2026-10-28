import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { AnalysisScreen } from './AnalysisScreen';
import { RecordDetailScreen } from './RecordDetailScreen';
import { RecordsScreen } from './RecordsScreen';

// 5.1 전체 기록, 5.2 기록 상세, 5.3 러닝 분석. They follow the screen mode like 2.1 홈.
export const recordScreens: Partial<Record<RouteName, React.ComponentType>> = {
  Records: RecordsScreen,
  RecordDetail: RecordDetailScreen,
  Analysis: AnalysisScreen,
};
