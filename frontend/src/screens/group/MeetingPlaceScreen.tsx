import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, TextField } from '../../components';
import { useRepositories, type MeetingPlace } from '../../data';
import {
  fontFamily,
  k1,
  size,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';
import { GlowButton } from '../course/TodayRunScreen';
import { MockMap } from '../run/MockMap';
import { FooterButton } from './GroupRunDetailScreen';
import { Tag, useGroupRunDraft } from './parts';

const formatDistance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;

// 6.9 만남 장소 선택 and 6.9b 장소 확정. Until the map SDK (S15P31E105-180) the place is picked
// from search results instead of by dragging the map.
export function MeetingPlaceScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { groupRuns } = useRepositories();
  const { draft, setPlace } = useGroupRunDraft();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[]>([]);
  const [picked, setPicked] = useState<MeetingPlace | null>(draft.place);
  const [confirming, setConfirming] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [note, setNote] = useState(draft.place?.note ?? '');

  const search = useCallback(
    (text: string) => {
      groupRuns.searchPlaces(text).then(found => {
        setResults(found);
        setPicked(current => current ?? found[0] ?? null);
      });
    },
    [groupRuns],
  );
  useEffect(() => search(''), [search]);

  const choose = (place: MeetingPlace) => {
    setPicked(place);
    setQuery('');
    search('');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* White status bar text over the dark map. */}
      <StatusBar barStyle="light-content" />
      {/* The K1 dark map fills the screen (DESIGN.md 2-10 장소 선택). */}
      <MockMap k1Style night position={picked?.position} positionY={340} />
      {/* The pin stands on the picked point (the map's position dot). */}
      <View style={styles.pinLayer} pointerEvents="none">
        <View style={styles.pin}>
          {!confirming ? (
            <View style={styles.tip}>
              <AppText variant="label" style={styles.tipText}>
                장소를 검색하거나 아래에서 고르세요
              </AppText>
            </View>
          ) : null}
          <Icon name="mapPin" color={k1.ice} size={44} strokeWidth={2.4} />
        </View>
      </View>
      <ThemeProvider tone="dark">
        <SafeAreaView
          edges={['top']}
          style={styles.top}
          pointerEvents="box-none"
        >
          <View style={styles.searchRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={() => navigation.goBack()}
              style={styles.mapButton}
            >
              <Icon name="back" color={k1.ice} size={20} />
            </Pressable>
            {/* Black 55% search pill (DESIGN.md 2-10 장소 선택). */}
            <View style={styles.search}>
              <Icon name="search" color={k1.ice} size={16} />
              <TextInput
                accessibilityLabel="장소·주소 검색"
                placeholder="장소·주소 검색"
                placeholderTextColor="rgba(232,238,244,0.62)"
                value={query}
                onChangeText={text => {
                  setQuery(text);
                  setConfirming(false);
                  search(text);
                }}
                style={[styles.searchInput, { color: k1.ice }]}
              />
            </View>
          </View>
          {query ? (
            <ThemeProvider tone="light">
              <View style={[styles.results, { backgroundColor: k1.ice }]}>
                {results.length ? (
                  results.map(place => (
                    <Pressable
                      key={place.name}
                      accessibilityRole="button"
                      accessibilityLabel={place.name}
                      onPress={() => choose(place)}
                      style={styles.result}
                    >
                      <Icon
                        name="mapPin"
                        color={colors.textSecondary}
                        size={16}
                      />
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong">{place.name}</AppText>
                        <AppText variant="caption" tone="textTertiary">
                          {place.address}
                        </AppText>
                      </View>
                      <AppText variant="label" tone="textTertiary">
                        {formatDistance(place.distanceM)}
                      </AppText>
                    </Pressable>
                  ))
                ) : (
                  <AppText
                    variant="caption"
                    tone="textTertiary"
                    style={styles.noResult}
                  >
                    찾는 장소가 없어요
                  </AppText>
                )}
              </View>
            </ThemeProvider>
          ) : null}
          {!confirming && !query ? (
            <View style={styles.locate}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="내 위치로"
                onPress={() => results[0] && choose(results[0])}
                style={styles.mapButton}
              >
                <Icon name="locate" color={k1.ice} size={20} />
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
      </ThemeProvider>
      {/* White sheet with corners of 34 (DESIGN.md 2-10 장소 선택). */}
      <SafeAreaView
        edges={['bottom']}
        style={[styles.sheet, { backgroundColor: k1.ice }]}
      >
        <View
          style={[styles.handle, { backgroundColor: colors.borderStrong }]}
        />
        {confirming && picked ? (
          <View style={styles.sheetBody}>
            <View style={styles.confirmed}>
              <Tag label="✓ 위치 확정" tone="accent" />
              <AppText
                variant="caption"
                tone="textSecondary"
                numberOfLines={1}
                style={styles.flex}
              >
                {picked.address}
              </AppText>
            </View>
            <TextField
              label="장소 이름"
              value={placeName}
              onChangeText={setPlaceName}
            />
            <TextField
              label="찾아오는 법 · 선택"
              placeholder="예: 편의점 앞 계단, 민트색 모자"
              value={note}
              onChangeText={setNote}
            />
            <View style={styles.buttons}>
              <FooterButton
                title="다시 고르기"
                onPress={() => setConfirming(false)}
              />
              <FooterButton
                title="확정"
                primary
                disabled={!placeName.trim()}
                onPress={() => {
                  setPlace({
                    ...picked,
                    name: placeName.trim(),
                    note: note.trim() || null,
                  });
                  navigation.goBack();
                }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.sheetBody}>
            {!query ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.nearby}
              >
                {results.map(place => {
                  const selected = place.name === picked?.name;
                  return (
                    <Pressable
                      key={place.name}
                      accessibilityRole="radio"
                      accessibilityLabel={place.name}
                      accessibilityState={{ selected }}
                      onPress={() => setPicked(place)}
                      style={[
                        styles.nearbyChip,
                        selected
                          ? {
                              backgroundColor: colors.accent,
                              borderColor: colors.accent,
                            }
                          : { borderColor: colors.borderStrong },
                      ]}
                    >
                      <AppText
                        variant="captionStrong"
                        style={{
                          color: selected ? colors.onAccent : colors.text,
                        }}
                      >
                        {place.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {picked ? (
              <View style={styles.pickedRow}>
                <Icon name="mapPin" color={colors.text} size={18} />
                <View style={styles.flex}>
                  <AppText style={styles.placeName}>{picked.name}</AppText>
                  <AppText variant="caption" tone="textSecondary">
                    {picked.address}
                  </AppText>
                </View>
                <AppText tone="textSecondary" style={styles.distance}>
                  {formatDistance(picked.distanceM)}
                </AppText>
              </View>
            ) : null}
            <GlowButton
              title="이 위치로 정하기"
              icon="check"
              disabled={!picked}
              onPress={() => {
                setPlaceName(picked?.name ?? '');
                setConfirming(true);
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pinLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // MockMap draws the picked point at y=340 of its 760-high frame.
  pin: {
    position: 'absolute',
    top: '44.7%',
    alignItems: 'center',
    // The pin's tip lands on the point; the tooltip floats above the pin.
    transform: [{ translateY: -42 }],
  },
  // A white pill above the pin (DESIGN.md 2-10 장소 선택 안내).
  tip: {
    position: 'absolute',
    bottom: 52,
    width: 250,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: k1.ice,
  },
  tipText: { color: k1.night },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  searchRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  mapButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(2,5,14,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    backgroundColor: 'rgba(2,5,14,0.55)',
  },
  // Without a lineHeight, as in TextField, so the glyphs are not clipped.
  searchInput: {
    flex: 1,
    height: 48,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  results: {
    marginHorizontal: spacing.screen,
    borderRadius: 22,
    paddingVertical: spacing.sm,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  noResult: { padding: spacing.xl, textAlign: 'center' },
  locate: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.screen,
    marginTop: 260,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.md,
  },
  sheetBody: { padding: spacing.screen, gap: spacing.xl },
  nearby: { gap: spacing.md },
  nearbyChip: {
    height: 32,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  placeName: { fontFamily: fontFamily.medium, fontSize: 17, lineHeight: 24 },
  distance: { fontFamily: fontFamily.numberRegular, fontSize: 15 },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.md },
});
