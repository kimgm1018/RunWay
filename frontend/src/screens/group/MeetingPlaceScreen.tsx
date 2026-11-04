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
import { AppText, Icon, LightGlass, TextField } from '../../components';
import { useRepositories, type MeetingPlace } from '../../data';
import {
  fontFamily,
  size,
  spacing,
  ThemeProvider,
  typography,
} from '../../theme';
import { MockMap } from '../run/MockMap';
import { FooterButton } from './GroupRunDetailScreen';
import { groupLook, Raised } from './look';
import { Tag, useGroupRunDraft } from './parts';

const formatDistance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;

// 이 위치로 정하기 (6.9-PlaceSheet): a raised navy pill with a white circle ✓ at its end.
function ConfirmButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="이 위치로 정하기"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      <Raised tone="navy" style={styles.confirm}>
        <View style={[styles.confirmContent, disabled && styles.dimmed]}>
          <AppText style={styles.confirmText}>이 위치로 정하기</AppText>
          <View style={styles.confirmIcon}>
            <Icon name="check" color={groupLook.onLight} size={18} />
          </View>
        </View>
      </Raised>
    </Pressable>
  );
}

// 6.9 만남 장소 선택 and 6.9b 장소 확정. Until the map SDK (S15P31E105-180) the place is picked
// from search results instead of by dragging the map. runway-group-handoff: the light map with a navy pin,
// and light glass for the search, the buttons and the sheet. The sheet shows the picked place's own
// address and distance.
export function MeetingPlaceScreen() {
  const navigation = useNavigation();
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
    // The map is light whatever the screen mode, so the screen takes the light theme.
    <ThemeProvider tone="light">
      <View style={[styles.root, styles.ground]}>
        <StatusBar barStyle="dark-content" />
        {/* 6.9-MapView: the light thin-line map, the picked point where the pin stands. */}
        <MockMap k1Style position={picked?.position} positionY={377} />
        <View style={styles.pinLayer} pointerEvents="none">
          <View style={styles.pin}>
            {!confirming ? (
              <LightGlass radius={13} style={styles.tip}>
                <AppText style={styles.tipText}>
                  장소를 검색하거나 아래에서 고르세요
                </AppText>
              </LightGlass>
            ) : null}
            <Icon
              name="mapPin"
              color={groupLook.onLight}
              size={44}
              strokeWidth={2.4}
            />
          </View>
        </View>
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
              style={({ pressed }) => pressed && styles.pressed}
            >
              <LightGlass radius={21} style={styles.mapButton}>
                <Icon name="back" color={groupLook.onLight} size={20} />
              </LightGlass>
            </Pressable>
            {/* 6.9-SearchBar: a light glass pill. */}
            <LightGlass radius={24} style={styles.search}>
              <Icon name="search" color={groupLook.onLightSub} size={16} />
              <TextInput
                accessibilityLabel="장소·주소 검색"
                placeholder="장소·주소 검색"
                placeholderTextColor={groupLook.onLightSub}
                value={query}
                onChangeText={text => {
                  setQuery(text);
                  setConfirming(false);
                  search(text);
                }}
                style={styles.searchInput}
              />
            </LightGlass>
          </View>
          {query ? (
            <LightGlass radius={22} style={styles.results}>
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
                      color={groupLook.onLightSub}
                      size={16}
                    />
                    <View style={styles.flex}>
                      <AppText style={styles.resultName}>{place.name}</AppText>
                      <AppText style={styles.sub}>{place.address}</AppText>
                    </View>
                    <AppText style={styles.sub}>
                      {formatDistance(place.distanceM)}
                    </AppText>
                  </Pressable>
                ))
              ) : (
                <AppText style={[styles.sub, styles.noResult]}>
                  찾는 장소가 없어요
                </AppText>
              )}
            </LightGlass>
          ) : null}
          {!confirming && !query ? (
            <View style={styles.locate}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="내 위치로"
                onPress={() => results[0] && choose(results[0])}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <LightGlass radius={22} style={styles.locateButton}>
                  <Icon name="locate" color={groupLook.onLight} size={20} />
                </LightGlass>
              </Pressable>
            </View>
          ) : null}
        </SafeAreaView>
        {/* 6.9-PlaceSheet: a light glass sheet with corners of 32. */}
        <View style={styles.sheet}>
          <LightGlass radius={32} style={styles.sheetGlass}>
            <SafeAreaView edges={['bottom']}>
              <View style={styles.handle} />
              {confirming && picked ? (
                <View style={styles.sheetBody}>
                  <View style={styles.confirmed}>
                    <Tag label="✓ 위치 확정" tone="accent" />
                    <AppText
                      style={[styles.sub, styles.flex]}
                      numberOfLines={1}
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
                            style={({ pressed }) => pressed && styles.pressed}
                          >
                            <Raised
                              tone={selected ? 'navy' : 'white'}
                              style={styles.nearbyChip}
                            >
                              <AppText
                                style={[
                                  styles.chipText,
                                  selected && styles.chipTextOn,
                                ]}
                              >
                                {place.name}
                              </AppText>
                            </Raised>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  ) : null}
                  {picked ? (
                    <View style={styles.pickedRow}>
                      <Icon name="mapPin" color={groupLook.onLight} size={18} />
                      <View style={styles.flex}>
                        <AppText style={styles.placeName}>
                          {picked.name}
                        </AppText>
                        <AppText style={styles.sub}>{picked.address}</AppText>
                      </View>
                      <AppText style={styles.distance}>
                        {formatDistance(picked.distanceM)}
                      </AppText>
                    </View>
                  ) : null}
                  <ConfirmButton
                    disabled={!picked}
                    onPress={() => {
                      setPlaceName(picked?.name ?? '');
                      setConfirming(true);
                    }}
                  />
                </View>
              )}
            </SafeAreaView>
          </LightGlass>
        </View>
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  ground: { backgroundColor: groupLook.mapBackground },
  pressed: { transform: [{ scale: 0.97 }] },
  dimmed: { opacity: 0.45 },
  pinLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // MockMap draws the picked point at y=377 of its 844-high frame.
  pin: {
    position: 'absolute',
    top: '44.7%',
    alignItems: 'center',
    // The pin's tip lands on the point; the hint floats above the pin.
    transform: [{ translateY: -42 }],
  },
  // 6.9-HintToast: a light glass pill above the pin.
  tip: {
    position: 'absolute',
    bottom: 52,
    width: 250,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  tipText: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: groupLook.onLight,
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  searchRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 17,
    paddingRight: 15,
  },
  mapButton: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flex: 1,
    height: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 14,
    paddingRight: 16,
  },
  // Without a lineHeight, as in TextField, so the glyphs are not clipped.
  searchInput: {
    flex: 1,
    height: 47,
    fontFamily: typography.input.fontFamily,
    fontSize: 16,
    paddingVertical: 0,
    textAlignVertical: 'center',
    color: groupLook.onLight,
  },
  results: {
    marginHorizontal: spacing.screen,
    paddingVertical: spacing.sm,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  resultName: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onLight,
  },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 12.5,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  noResult: { padding: spacing.xl, textAlign: 'center' },
  locate: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.screen,
    marginTop: 260,
  },
  locateButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // The glass's own bottom corners sit below the screen edge.
  sheetGlass: { marginBottom: -32, paddingBottom: 32 },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 7.5,
    backgroundColor: 'rgba(2,5,14,0.18)',
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 12,
  },
  nearby: { gap: 8, paddingVertical: 4 },
  nearbyChip: {
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 16,
    justifyContent: 'center',
  },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    letterSpacing: -0.3,
    color: groupLook.onLightSub2,
  },
  chipTextOn: { color: groupLook.onDark },
  pickedRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingLeft: 2,
  },
  placeName: {
    fontFamily: fontFamily.bold,
    fontSize: 17.5,
    lineHeight: 23,
    letterSpacing: -0.4,
    color: groupLook.onLight,
  },
  distance: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 14.5,
    color: groupLook.onLightSub,
  },
  confirm: {
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
  },
  confirmContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 8,
  },
  confirmText: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    color: groupLook.onDark,
  },
  confirmIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.md },
});
