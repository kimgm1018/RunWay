import React from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { useRunForeground } from '../useRunForeground';

test.each(['background', null] as const)('mounting with %s waits for active state and a focused Android window', initial => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const descriptor = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: initial });
  const listeners = new Map<string, (state: AppStateStatus) => void>();
  const original = AppState.addEventListener;
  AppState.addEventListener = (name, listener) => {
    listeners.set(name, listener);
    return { remove: () => { listeners.delete(name); } };
  };
  let foreground = false;
  let screen!: TestRenderer.ReactTestRenderer;
  function Probe() {
    foreground = useRunForeground();
    return null;
  }
  try {
    act(() => { screen = TestRenderer.create(<Probe />); });
    expect(foreground).toBe(false);
    act(() => { listeners.get('change')!('active'); });
    expect(foreground).toBe(false);
    act(() => { listeners.get('focus')!('active'); });
    expect(foreground).toBe(true);
    act(() => { listeners.get('blur')!('active'); });
    expect(foreground).toBe(false);
  } finally {
    act(() => screen.unmount());
    expect(listeners.size).toBe(0);
    AppState.addEventListener = original;
    Object.defineProperty(AppState, 'currentState', descriptor);
    os.restore();
  }
});
