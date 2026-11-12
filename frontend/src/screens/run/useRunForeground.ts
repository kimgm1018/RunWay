import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

// Recording continues in the background; native screen transitions wait until the app window is visible again.
export function useRunForeground() {
  const [active, setActive] = useState(() => AppState.currentState === 'active');
  const [focused, setFocused] = useState(() => Platform.OS !== 'android' || AppState.currentState === 'active');
  useEffect(() => {
    const state = AppState.addEventListener('change', next => setActive(next === 'active'));
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => setFocused(true)) : null;
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => setFocused(false)) : null;
    return () => {
      state.remove();
      focus?.remove();
      blur?.remove();
    };
  }, []);
  return active && focused;
}
