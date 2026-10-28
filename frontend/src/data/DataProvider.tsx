import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import type { Repositories } from './types';

const DataContext = createContext<Repositories | null>(null);

export function DataProvider({
  repositories,
  children,
}: {
  repositories: Repositories;
  children: React.ReactNode;
}) {
  return (
    <DataContext.Provider value={repositories}>{children}</DataContext.Provider>
  );
}

export function useRepositories() {
  const value = useContext(DataContext);
  if (!value) {
    throw new Error('useRepositories must be used inside DataProvider');
  }
  return value;
}

export type Resource<T> =
  | { status: 'loading'; data: null; reload: () => void }
  | { status: 'ready'; data: T; reload: () => void }
  | { status: 'error'; data: null; error: Error; reload: () => void };

// Loads one repository call for a screen; pass a stable `load` (wrap it in useCallback).
export function useResource<T>(
  load: (repositories: Repositories) => Promise<T>,
) {
  const repositories = useRepositories();
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; data: T }
    | { status: 'error'; error: Error }
  >({ status: 'loading' });
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    load(repositories).then(
      data => active && setState({ status: 'ready', data }),
      error =>
        active &&
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        }),
    );
    return () => {
      active = false;
    };
  }, [attempt, load, repositories]);
  if (state.status === 'ready') {
    return { ...state, reload } as Resource<T>;
  }
  if (state.status === 'error') {
    return { ...state, data: null, reload } as Resource<T>;
  }
  return { status: 'loading', data: null, reload } as Resource<T>;
}
