import React, { createContext, useContext, useMemo, useState } from 'react';
import type {
  CourseRecommendations,
  CourseSearch,
  RecommendedCourse,
} from '../../data';

// The next page of courses is asked at most this many times per search (첫 추천 + 2번, S15P31E105-383).
export const MAX_REROLLS = 2;

// 3.1 sets the conditions and the results; 3.1b reads them. 조건 변경 goes back with the inputs kept.
type CourseSearchValue = {
  search: CourseSearch | null;
  results: RecommendedCourse[] | null;
  // About the whole answer (Route notices), and the seed for 다른 코스; null when there is no more.
  notices: string[];
  nextSeed: number | null;
  // Next pages shown for this search; a new search from 3.1 starts again at 0.
  rerolls: number;
  // Counts the searches, so 3.1b can go back to the first card when a new one replaces the row.
  round: number;
  // more appends the answer after the courses already shown (S15P31E105-474) instead of replacing them.
  setSearch: (
    search: CourseSearch,
    found: CourseRecommendations,
    more?: boolean,
  ) => void;
  setResults: (results: RecommendedCourse[]) => void;
};

const CourseSearchContext = createContext<CourseSearchValue | null>(null);

export function CourseSearchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [search, setSearchState] = useState<CourseSearch | null>(null);
  const [results, setResults] = useState<RecommendedCourse[] | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [nextSeed, setNextSeed] = useState<number | null>(null);
  const [rerolls, setRerolls] = useState(0);
  const [round, setRound] = useState(0);
  const value = useMemo(
    () => ({
      search,
      results,
      notices,
      nextSeed,
      rerolls,
      round,
      setSearch: (
        next: CourseSearch,
        found: CourseRecommendations,
        more = false,
      ) => {
        setSearchState(next);
        // A course already on screen is not added twice.
        setResults(shown =>
          more && shown
            ? [
                ...shown,
                ...found.courses.filter(
                  course => !shown.some(item => item.id === course.id),
                ),
              ]
            : found.courses,
        );
        setNotices(found.notices);
        setNextSeed(found.nextSeed);
        setRerolls(count => (more ? count + 1 : 0));
        if (!more) {
          setRound(count => count + 1);
        }
      },
      setResults,
    }),
    [search, results, notices, nextSeed, rerolls, round],
  );
  return (
    <CourseSearchContext.Provider value={value}>
      {children}
    </CourseSearchContext.Provider>
  );
}

export function useCourseSearch() {
  const value = useContext(CourseSearchContext);
  if (!value) {
    throw new Error('useCourseSearch must be used inside CourseSearchProvider');
  }
  return value;
}
