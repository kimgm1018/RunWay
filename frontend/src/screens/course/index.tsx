import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { RecommendedCoursesScreen } from './RecommendedCoursesScreen';
import { SavedCoursesScreen } from './SavedCoursesScreen';
import { TodayRunScreen } from './TodayRunScreen';

export { CourseSearchProvider } from './CourseSearch';

// 3.1 오늘의 러닝 (3.1p 페이스 입력 included), 3.1b 추천 코스 (card back = 코스 상세), 3.1c 저장한 코스.
export const courseScreens: Partial<Record<RouteName, React.ComponentType>> = {
  TodayRun: TodayRunScreen,
  RecommendedCourses: RecommendedCoursesScreen,
  SavedCourses: SavedCoursesScreen,
};
