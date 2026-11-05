import { useCallback, useEffect, useRef } from 'react';

// Which request is still the one to show. A ticket goes stale when a newer request starts, when `key`
// changes (e.g. the search was replaced on 3.1) or when the screen closes, so a late answer is dropped.
export function useRequestTicket(key: unknown) {
  const current = useRef(0);
  useEffect(() => {
    current.current += 1;
  }, [key]);
  useEffect(
    () => () => {
      current.current += 1;
    },
    [],
  );
  const take = useCallback(() => {
    current.current += 1;
    return current.current;
  }, []);
  const isCurrent = useCallback(
    (ticket: number) => ticket === current.current,
    [],
  );
  return { take, isCurrent };
}
