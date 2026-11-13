import React, { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components';
import { formatPace } from '../../format';
import { fontFamily, k1 } from '../../theme';

// km별 추천 페이스 pills (S15P31E105-733), shared by the solo course start and the group run (S15P31E105-739):
// one small pill a km. The last pill of a distance that does not end on a whole km is labelled by its end (5.3km).
export function kmLabel(index: number, count: number, distanceM: number) {
  return index === count - 1 && distanceM % 1000 !== 0
    ? `${(distanceM / 1000).toFixed(1)}km`
    : `${index + 1}km`;
}

export function KmPacePills({
  paces,
  distanceM,
}: {
  paces: number[];
  distanceM: number;
}) {
  return (
    <View style={styles.row} accessibilityLabel="km별 추천 페이스">
      {paces.map((value, index) => (
        <View key={index} style={styles.pill}>
          <AppText style={styles.label}>
            {kmLabel(index, paces.length, distanceM)}
          </AppText>
          <AppText style={styles.pace}>{formatPace(value)}</AppText>
        </View>
      ))}
    </View>
  );
}

// S15P31E105-739: the group run's km paces open only on a press ('km별 보기 ▾'), on the detail card and in the
// waiting room alike. Callers leave it out while the server recalculates or has none.
export function KmPaceToggle({
  paces,
  distanceM,
  color,
  map,
}: {
  paces: number[];
  distanceM: number;
  color: string;
  // Shown over the pills while open, and hidden with them (the waiting room's course map).
  map?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="km별 페이스 보기"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(value => !value)}
        hitSlop={8}
        style={styles.toggle}
      >
        <AppText style={[styles.toggleText, { color }]}>
          {open ? 'km별 접기 ▴' : 'km별 보기 ▾'}
        </AppText>
      </Pressable>
      {open ? (
        <>
          {map}
          <KmPacePills paces={paces} distanceM={distanceM} />
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { alignSelf: 'flex-start', paddingVertical: 2 },
  toggleText: {
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: k1.light,
  },
  label: {
    fontFamily: fontFamily.regular,
    fontSize: 11,
    lineHeight: 15,
    color: '#67696E',
  },
  pace: {
    fontFamily: fontFamily.bold,
    fontSize: 13,
    lineHeight: 18,
    color: '#02050E',
  },
});
