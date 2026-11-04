import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
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

type Reloads = {
  reload: () => void;
  // Loads again while the current data stays on screen; settles when the new load does.
  refresh: () => Promise<void>;
};

export type Resource<T> =
  | ({ status: 'loading'; data: null } & Reloads)
  | ({ status: 'ready'; data: T } & Reloads)
  | ({ status: 'error'; data: null; error: Error } & Reloads);

// Loads one repository call for a screen; pass a stable `load` (wrap it in useCallback).
export function useResource<T>(
  load: (repositories: Repositories) => Promise<T>,
) {
  const repositories = useRepositories();
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt(value => value + 1), []);
  // Set by refresh for the next load only, with the callers waiting for it.
  const keep = useRef(false);
  const waiting = useRef<(() => void)[]>([]);
  const refresh = useCallback(
    () =>
      new Promise<void>(resolve => {
        keep.current = true;
        waiting.current.push(resolve);
        setAttempt(value => value + 1);
      }),
    [],
  );
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; data: T }
    | { status: 'error'; error: Error }
  >({ status: 'loading' });
  useEffect(() => {
    let active = true;
    if (!keep.current) {
      setState({ status: 'loading' });
    }
    keep.current = false;
    // Only the refreshes that asked for this load wait for it, not one that a later refresh replaced.
    const waiters = waiting.current.splice(0);
    const settle = () => waiters.forEach(resolve => resolve());
    load(repositories).then(
      data => {
        if (active) {
          setState({ status: 'ready', data });
        }
        settle();
      },
      error => {
        if (active) {
          setState({
            status: 'error',
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
        settle();
      },
    );
    return () => {
      active = false;
    };
  }, [attempt, load, repositories]);
  if (state.status === 'ready') {
    return { ...state, reload, refresh } as Resource<T>;
  }
  if (state.status === 'error') {
    return { ...state, data: null, reload, refresh } as Resource<T>;
  }
  return { status: 'loading', data: null, reload, refresh } as Resource<T>;
}
