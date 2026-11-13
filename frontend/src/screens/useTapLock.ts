import { useCallback, useContext, useEffect, useRef } from 'react';
import { NavigationContext } from '@react-navigation/native';

// S15P31E105-796: a fast second tap arrives before React has re-rendered a `disabled={busy}` button, so the request
// or the navigation ran two or three times (회원가입 연타). The first tap locks a ref, which changes at once: a
// handler that returns a promise keeps the lock until it settles, and any other handler holds it for `holdMs`, long
// enough for the next screen to take over. Coming back to the screen (뒤로) opens it again at once.
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | null)?.then === 'function';

export function useTapLock(holdMs = 800) {
  const locked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Without a navigator (a bare component) there is nothing to come back to, so only the time releases.
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    const clear = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
    const stopListening = navigation?.addListener('focus', () => {
      clear();
      locked.current = false;
    });
    return () => {
      clear();
      stopListening?.();
    };
  }, [navigation]);
  return useCallback(
    (action: () => unknown) => () => {
      if (locked.current) {
        return;
      }
      locked.current = true;
      const release = () => {
        locked.current = false;
      };
      let result: unknown;
      try {
        result = action();
      } catch (error) {
        release();
        throw error;
      }
      if (isThenable(result)) {
        result.then(release, release);
      } else {
        timer.current = setTimeout(release, holdMs);
      }
    },
    [holdMs],
  );
}
