import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { palette, radius, size, spacing } from '../theme';
import { AppText } from './AppText';

type ToastOptions = {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
};

type ToastState = ToastOptions & { id: number; message: string };

const ToastContext = createContext<
  ((message: string, options?: ToastOptions) => void) | null
>(null);

// 8.3: a dark pill above the tab bar with an optional undo action.
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const show = useCallback((message: string, options: ToastOptions = {}) => {
    nextId.current += 1;
    setToast({ ...options, message, id: nextId.current });
  }, []);
  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), toast.duration ?? 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.layer,
            { bottom: insets.bottom + size.tabBar + size.tabBarInset * 2 },
          ]}
        >
          <View accessibilityLiveRegion="polite" style={styles.toast}>
            <AppText variant="bodyStrong" style={styles.message}>
              {toast.message}
            </AppText>
            {toast.actionLabel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={toast.actionLabel}
                onPress={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
                hitSlop={8}
              >
                <AppText variant="bodyStrong" style={styles.action}>
                  {toast.actionLabel}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) {
    throw new Error('useToast must be used inside ToastProvider');
  }
  return show;
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: spacing.screen,
    right: spacing.screen,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    maxWidth: '100%',
    paddingHorizontal: 18,
    paddingVertical: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(22,24,31,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  message: { flexShrink: 1, color: palette.white },
  action: { color: palette.mint },
});
