import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { AppText, BottomSheet, Button, Icon } from '../../components';
import { useRepositories, type FeedRegionProvince } from '../../data';
import { spacing, useTheme } from '../../theme';

// 7.1 지역 고르기 (S15P31E105-687): 전국, a 시·도 or one of its 시·군·구 from CMT12. A 시·도 opens its 시·군·구, with
// the whole 시·도 first; 전국 shows every post again.

// The region the feed keeps: null code is 전국. The label is what the 지역 chip shows (‘부산’, ‘부산 해운대구’).
export type FeedRegion = { code: string | null; label: string };

export const NATIONWIDE: FeedRegion = { code: null, label: '전국' };

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; provinces: FeedRegionProvince[] };

export function RegionSheet({
  visible,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  selected: FeedRegion;
  onClose: () => void;
  onSelect: (region: FeedRegion) => void;
}) {
  const { community } = useRepositories();
  const { colors } = useTheme();
  const [state, setState] = useState<State>({ status: 'loading' });
  // The 시·도 whose 시·군·구 are on show; null shows the 시·도.
  const [open, setOpen] = useState<FeedRegionProvince | null>(null);
  const attempt = useRef(0);

  const load = useCallback(async () => {
    const current = ++attempt.current;
    setState({ status: 'loading' });
    try {
      const provinces = await community.listRegions();
      if (current === attempt.current) {
        setState(
          provinces.length
            ? { status: 'ready', provinces }
            : { status: 'error' },
        );
      }
    } catch {
      if (current === attempt.current) {
        setState({ status: 'error' });
      }
    }
  }, [community]);

  // Each opening starts at the 시·도. The list is read once per app run (CMT12 kept in the data layer), so
  // reading it again is cheap, and a failed read is tried again.
  useEffect(() => {
    if (visible) {
      setOpen(null);
      load();
    }
  }, [load, visible]);

  const row = (
    key: string,
    label: string,
    picked: boolean,
    onPress: () => void,
    more = false,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: picked }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border },
        pressed && styles.pressed,
      ]}
    >
      <AppText variant="body" style={styles.label}>
        {label}
      </AppText>
      {picked ? <Icon name="check" color={colors.text} size={18} /> : null}
      {more ? <Icon name="forward" color={colors.text} size={16} /> : null}
    </Pressable>
  );

  const pick = (region: FeedRegion) => {
    onSelect(region);
    onClose();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={open ? open.name : '지역 고르기'}
    >
      {state.status === 'loading' ? (
        <ActivityIndicator color={colors.text} style={styles.state} />
      ) : state.status === 'error' ? (
        <View style={styles.failed}>
          <AppText variant="body">지역 목록을 불러오지 못했어요</AppText>
          <Button
            title="다시 시도"
            variant="secondary"
            size="small"
            onPress={load}
          />
        </View>
      ) : open ? (
        <ScrollView style={styles.list}>
          {row('back', '다른 시·도 고르기', false, () => setOpen(null))}
          {row(
            open.code,
            `${open.name} 전체`,
            selected.code === open.code,
            () => pick({ code: open.code, label: open.name }),
          )}
          {open.areas.map(area =>
            row(area.code, area.name, selected.code === area.code, () =>
              pick({ code: area.code, label: `${open.name} ${area.name}` }),
            ),
          )}
        </ScrollView>
      ) : (
        <ScrollView style={styles.list}>
          {row('nationwide', '전국', selected.code === null, () =>
            pick(NATIONWIDE),
          )}
          {state.provinces.map(province =>
            row(
              province.code,
              province.name,
              selected.code === province.code ||
                province.areas.some(area => area.code === selected.code),
              () =>
                province.areas.length
                  ? setOpen(province)
                  : pick({ code: province.code, label: province.name }),
              province.areas.length > 0,
            ),
          )}
        </ScrollView>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  state: { marginVertical: spacing.xl },
  failed: { alignItems: 'flex-start', gap: spacing.md },
  list: { maxHeight: 420 },
  row: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
  pressed: { opacity: 0.6 },
});
