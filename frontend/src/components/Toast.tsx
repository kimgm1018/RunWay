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
import { k1, radius, size, spacing } from '../theme';
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

// 8.3: a light pill above the tab bar with an optional undo action (DESIGN.md 2-12).
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
                style={styles.actionPill}
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
    width: '100%',
    minHeight: 50,
    paddingLeft: 20,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: k1.ice,
    shadowColor: k1.night,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  message: { flex: 1, color: k1.night },
  actionPill: {
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(2,5,14,0.08)',
  },
  action: { color: k1.night },
});
