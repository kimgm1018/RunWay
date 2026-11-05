import React, { createContext, useContext, useMemo, useState } from 'react';
import type {
  CourseRecommendations,
  CourseSearch,
  RecommendedCourse,
} from '../../data';

// 3.1 sets the conditions and the results; 3.1b reads them. 조건 변경 goes back with the inputs kept.
type CourseSearchValue = {
  search: CourseSearch | null;
  results: RecommendedCourse[] | null;
  // About the whole answer (Route notices), and the seed for 다른 코스; null when there is no more.
  notices: string[];
  nextSeed: number | null;
  setSearch: (search: CourseSearch, found: CourseRecommendations) => void;
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
  const value = useMemo(
    () => ({
      search,
      results,
      notices,
      nextSeed,
      setSearch: (next: CourseSearch, found: CourseRecommendations) => {
        setSearchState(next);
        setResults(found.courses);
        setNotices(found.notices);
        setNextSeed(found.nextSeed);
      },
      setResults,
    }),
    [search, results, notices, nextSeed],
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
