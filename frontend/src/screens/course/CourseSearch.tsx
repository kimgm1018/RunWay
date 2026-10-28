import React, { createContext, useContext, useMemo, useState } from 'react';
import type { CourseSearch, RecommendedCourse } from '../../data';

// 3.1 sets the conditions and the results; 3.1b reads them. 조건 변경 goes back with the inputs kept.
type CourseSearchValue = {
  search: CourseSearch | null;
  results: RecommendedCourse[] | null;
  setSearch: (search: CourseSearch, results: RecommendedCourse[]) => void;
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
  const value = useMemo(
    () => ({
      search,
      results,
      setSearch: (next: CourseSearch, found: RecommendedCourse[]) => {
        setSearchState(next);
        setResults(found);
      },
      setResults,
    }),
    [search, results],
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
