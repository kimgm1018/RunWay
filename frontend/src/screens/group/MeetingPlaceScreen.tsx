import React, { useEffect, useRef, useState } from 'react';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  Icon,
  KeyboardLift,
  LightGlass,
  PressableScale,
  TextField,
} from '../../components';
import { RunMap, type RunMapRef } from '../../components/RunMap';
import { useRepositories, type MeetingPlace } from '../../data';
import { placeAddressOf, placeNameOf } from '../../data/placeName';
import { distanceM, type LngLat } from '../../geo';
import {
  fontFamily,
  size,
  spacing,
  ThemeProvider,
  typography,
} from '../../theme';
import {
  locationFailureNotice,
  noLocationNotice,
} from '../course/currentLocation';
import {
  GROUP_RUN_NOTE_MAX,
  GROUP_RUN_PLACE_NAME_MAX,
  PLACE_SEARCH_MAX,
} from '../inputLimits';
import { groupLook, NumText } from './look';
import { ColorBar, stand, StandButton } from './stand';
import { Tag, useGroupRunDraft } from './parts';
import { GlassIconButton } from '../../components/GlassIconButton';

const formatDistance = (meters: number | null) =>
  meters === null || !Number.isFinite(meters)
    ? ''
    : meters >= 1000
    ? `${(meters / 1000).toFixed(1)}km`
    : `${Math.round(meters)}m`;

// A point picked on the map or at my location gets its name and address from the phone's geocoder
// (S15P31E105-696). Until it answers, or when it finds nothing, a fixed placeholder stands in rather than
// lat/lng text, so the saved meetingAddress is not mistaken for a road address (S15P31E105-637).
const mapPickedAddress = '지도에서 선택한 위치';

function mapPlace(
  position: LngLat,
  name: string,
  me: LngLat | null,
): MeetingPlace {
  return {
    name,
    address: mapPickedAddress,
    position,
    distanceM: me ? distanceM(me, position) : null,
  };
}

async function locationAllowed() {
  if (Platform.OS !== 'android') {
    return true;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

// 이 위치로 정하기 (6.9-PlaceSheet): a flat pill with a circle ✓ at its end, like the other group buttons
// (S15P31E105-563). On the navy sheet it is the home's white button with navy text and a navy circle
// (S15P31E105-594 담당자 결정: 진한 네이비 톤, 큰 버튼은 흰색).
function ConfirmButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel="이 위치로 정하기"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <View style={[styles.confirm, disabled && styles.confirmOff]}>
        <View style={[styles.confirmContent, disabled && styles.dimmed]}>
          <AppText style={styles.confirmText}>이 위치로 정하기</AppText>
          <View style={styles.confirmIcon}>
            <Icon name="check" color={stand.text} size={16} />
          </View>
        </View>
      </View>
    </PressableScale>
  );
}

// 6.9 만남 장소 선택 and 6.9b 장소 확정. The place is picked from the search results and nearby chips,
// by a tap on the Naver map, or at my location (S15P31E105-415); the map keeps it under the pin.
// runway-group-handoff: the light map with a navy pin,
// and light glass for the search, the buttons and the sheet. The sheet shows the picked place's own
// address and distance. S15P31E105-594 담당자 시안: the search results as rows of their own and the digits in
// Archivo; the colours stay as they were (담당자 결정: 색은 그대로, 구성만 시안대로).
export function MeetingPlaceScreen() {
  const navigation = useNavigation();
  const { groupRuns, phoneLocation } = useRepositories();
  const { draft, setPlace } = useGroupRunDraft();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<MeetingPlace | null>(draft.place);
  const [confirming, setConfirming] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [note, setNote] = useState(draft.place?.note ?? '');
  const map = useRef<RunMapRef>(null);
  const [me, setMe] = useState<LngLat | null>(null);
  // The GPS dot appears only after the location permission is granted.
  const [showMe, setShowMe] = useState(false);
  // True while the camera flies to my location; where it stops is the picked place.
  const locating = useRef(false);
  // 내 위치로 asks the phone for a fix; when it cannot give one the screen says why instead of staying silent
  // (S15P31E105-798, TEAM QA T22).
  const [findingMe, setFindingMe] = useState(false);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [recenter, setRecenter] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setResults([]);
    setSearchFailed(false);
    setSearching(Boolean(query.trim()));
    // 빈 검색은 mock의 기존 주변 후보만 유지한다. API는 빈 배열을 반환한다.
    const timer = setTimeout(
      () => {
        groupRuns.searchPlaces(query, me).then(
          found => {
            if (!active) return;
            setResults(found);
            setSearching(false);
          },
          () => {
            if (!active) return;
            setSearchFailed(true);
            setSearching(false);
          },
        );
      },
      query.trim() ? 300 : 0,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [groupRuns, query, me, attempt]);

  const choose = (place: MeetingPlace) => {
    setLocationNotice(null);
    setPicked(place);
    setQuery('');
  };

  // A point on the map shows at once under its placeholder, then takes the name and address the phone finds.
  // A later pick in the meantime keeps its own: the answer only lands on the point it was asked for.
  const pickPoint = (
    point: LngLat,
    fallbackName: string,
    from: LngLat | null,
  ) => {
    const place = mapPlace(point, fallbackName, from);
    setLocationNotice(null);
    setPicked(place);
    Promise.all([placeNameOf(point), placeAddressOf(point)]).then(
      ([name, address]) => {
        if (!name && !address) {
          return;
        }
        setPicked(current =>
          current?.position === point
            ? {
                ...current,
                name: name ?? current.name,
                address: address ?? current.address,
              }
            : current,
        );
      },
    );
  };

  // 내 위치로: the phone's own fix (permission, location off and timeout each answered with a notice). A device
  // with no phone location (iOS, the mock) keeps the map's own follow: with the permission it follows me once,
  // without it the nearest place.
  const goToMe = async () => {
    if (findingMe) {
      return;
    }
    setLocationNotice(null);
    if (!phoneLocation) {
      if (!(await locationAllowed())) {
        if (results[0]) {
          choose(results[0]);
        } else {
          setLocationNotice(
            `${noLocationNotice.title} ${noLocationNotice.detail}`,
          );
        }
        return;
      }
      locating.current = true;
      setShowMe(true);
      map.current?.setLocationTrackingMode('Follow');
      return;
    }
    setFindingMe(true);
    try {
      const fix = await phoneLocation.current();
      if (!mounted.current) {
        return;
      }
      const center: LngLat = [fix.longitude, fix.latitude];
      setShowMe(true);
      setMe(center);
      setConfirming(false);
      pickPoint(center, '내 위치', center);
      // Back to me even when the map was moved by hand to where the last pick stood.
      setRecenter(value => value + 1);
    } catch (error) {
      if (mounted.current) {
        const notice = locationFailureNotice(error);
        setLocationNotice(`${notice.title} ${notice.detail}`);
      }
    } finally {
      if (mounted.current) {
        setFindingMe(false);
      }
    }
  };

  return (
    // The map is light whatever the screen mode, so the screen takes the light theme.
    <ThemeProvider tone="light">
      <View style={[styles.root, styles.ground]}>
        <StatusBar barStyle="dark-content" />
        {/* 6.9-MapView: the light map, the picked point under the pin (377 of 844). */}
        <RunMap
          ref={map}
          position={picked?.position}
          showLocation={showMe}
          recenterSignal={recenter}
          area={{ top: 0.447, bottom: 0.447 }}
          // The NAVER logo just over the place sheet (S15P31E105-429).
          logo={{ above: 0.255 }}
          onTapMap={point => {
            setConfirming(false);
            pickPoint(point, '지도에서 고른 위치', me);
          }}
          onCameraIdle={center => {
            if (!locating.current) {
              return;
            }
            locating.current = false;
            map.current?.setLocationTrackingMode('NoFollow');
            setMe(center);
            setConfirming(false);
            pickPoint(center, '내 위치', center);
          }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.pinLayer} pointerEvents="none">
          <View style={styles.pin}>
            {!confirming ? (
              <View style={styles.tip}>
                <AppText style={styles.tipText}>
                  지도를 누르거나 장소를 검색하세요
                </AppText>
              </View>
            ) : null}
            {/* The mockup's mint pin, kept readable on the light map: a mint fill under the old navy outline
                (S15P31E105-594 담당자 요청). */}
            <View style={styles.pinIcon}>
              <Icon name="mapPin" color={groupLook.mint} size={44} solid />
              <View style={StyleSheet.absoluteFill}>
                <Icon
                  name="mapPin"
                  color={groupLook.onLight}
                  size={44}
                  strokeWidth={2.4}
                />
              </View>
            </View>
          </View>
        </View>
        <SafeAreaView
          edges={['top']}
          style={styles.top}
          pointerEvents="box-none"
        >
          <View style={styles.searchRow}>
            {/* A navy circle over the light map, as the search pill beside it (그룹런 시안). */}
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel="뒤로"
              onPress={() => navigation.goBack()}
              hitSlop={6}
              style={styles.back}
            >
              <Icon name="back" color={stand.text} size={20} />
            </PressableScale>
            {/* 6.9-SearchBar: a navy pill over the light map (그룹런 시안, S15P31E105-673). */}
            <View style={styles.search}>
              <Icon name="search" color={stand.sub} size={16} />
              <TextInput
                accessibilityLabel="장소·주소 검색"
                placeholder="장소·주소 검색"
                placeholderTextColor={stand.sub}
                selectionColor={stand.mint}
                value={query}
                maxLength={PLACE_SEARCH_MAX}
                onChangeText={text => {
                  setQuery(text);
                  setResults([]);
                  setSearching(Boolean(text.trim()));
                  setSearchFailed(false);
                  setConfirming(false);
                }}
                style={styles.searchInput}
              />
            </View>
          </View>
          {/* The mockup's results: each place a light row of its own under the search, opaque so the map
              behind does not show through the names (S15P31E105-679). */}
          {query ? (
            <View style={styles.results}>
              {searching ? (
                <LightGlass
                  radius={16}
                  solid={resultSurface}
                  style={styles.resultCard}
                >
                  <AppText style={[styles.sub, styles.noResult]}>
                    검색 중이에요
                  </AppText>
                </LightGlass>
              ) : searchFailed ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="장소 검색 다시 시도"
                  onPress={() => setAttempt(value => value + 1)}
                >
                  <LightGlass
                    radius={16}
                    solid={resultSurface}
                    style={styles.resultCard}
                  >
                    <AppText style={[styles.sub, styles.noResult]}>
                      검색하지 못했어요. 눌러서 다시 시도해 주세요
                    </AppText>
                  </LightGlass>
                </Pressable>
              ) : results.length ? (
                results.map(place => (
                  <Pressable
                    key={`${place.name}:${place.address}:${place.position.join(
                      ',',
                    )}`}
                    accessibilityRole="button"
                    accessibilityLabel={place.name}
                    onPress={() => choose(place)}
                  >
                    <LightGlass
                      radius={16}
                      solid={resultSurface}
                      style={[styles.resultCard, styles.result]}
                    >
                      <Icon
                        name="mapPin"
                        color={groupLook.onLightSub}
                        size={16}
                      />
                      <View style={styles.flex}>
                        <AppText style={styles.resultName}>
                          {place.name}
                        </AppText>
                        <NumText text={place.address} style={styles.sub} />
                      </View>
                      <NumText
                        text={formatDistance(place.distanceM)}
                        style={styles.sub}
                      />
                    </LightGlass>
                  </Pressable>
                ))
              ) : (
                <LightGlass
                  radius={16}
                  solid={resultSurface}
                  style={styles.resultCard}
                >
                  <AppText style={[styles.sub, styles.noResult]}>
                    찾는 장소가 없어요
                  </AppText>
                </LightGlass>
              )}
            </View>
          ) : null}
          {!confirming && !query ? (
            <View style={styles.locate}>
              <GlassIconButton
                icon="locate"
                accessibilityLabel="내 위치로"
                disabled={findingMe}
                onPress={goToMe}
              />
              {locationNotice ? (
                <View
                  style={styles.locateNotice}
                  accessibilityLiveRegion="polite"
                >
                  <AppText style={styles.locateNoticeText}>
                    {locationNotice}
                  </AppText>
                </View>
              ) : null}
            </View>
          ) : null}
        </SafeAreaView>
        {/* 6.9-PlaceSheet: a sheet with corners of 32. The keyboard lifts it (S15P31E105-473). */}
        <KeyboardLift style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={styles.sheet}>
            {/* A navy sheet with white text over the light map (S15P31E105-594 담당자 결정: 진한 네이비 톤). The dark
                theme draws its fields, the ✓ 위치 확정 tag and the FooterButtons light: 확정 white with navy text. */}
            <LightGlass
              radius={20}
              solid={sheetNavy}
              style={[styles.sheetGlass, styles.sheetSolid]}
            >
              <ThemeProvider tone="dark">
                <SafeAreaView edges={['bottom']}>
                  <View style={styles.handle} />
                  {confirming && picked ? (
                    <View style={styles.sheetBody}>
                      <View style={styles.confirmed}>
                        <Tag label="✓ 위치 확정" tone="accent" />
                        <NumText
                          text={picked.address}
                          style={[styles.sheetSub, styles.flex]}
                          numberOfLines={1}
                        />
                      </View>
                      <TextField
                        label="장소 이름"
                        value={placeName}
                        onChangeText={setPlaceName}
                        maxLength={GROUP_RUN_PLACE_NAME_MAX}
                      />
                      <TextField
                        label="찾아오는 법 · 선택"
                        placeholder="예: 편의점 앞 계단, 민트색 모자"
                        value={note}
                        onChangeText={setNote}
                        maxLength={GROUP_RUN_NOTE_MAX}
                      />
                      <View style={styles.buttons}>
                        <StandButton
                          title="다시 고르기"
                          tone="outline"
                          style={styles.flex}
                          onPress={() => setConfirming(false)}
                        />
                        <StandButton
                          title="확정"
                          style={styles.flex}
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
                              <PressableScale
                                key={place.name}
                                accessibilityRole="radio"
                                accessibilityLabel={place.name}
                                accessibilityState={{ selected }}
                                onPress={() => setPicked(place)}
                              >
                                <View
                                  style={[
                                    styles.nearbyChip,
                                    selected && styles.nearbyChipOn,
                                  ]}
                                >
                                  <AppText
                                    style={[
                                      styles.chipText,
                                      selected && styles.chipTextOn,
                                    ]}
                                  >
                                    {place.name}
                                  </AppText>
                                </View>
                              </PressableScale>
                            );
                          })}
                        </ScrollView>
                      ) : null}
                      {picked ? (
                        <View style={styles.pickedRow}>
                          <ColorBar color={stand.mint} />
                          <Icon name="mapPin" color={stand.text} size={18} />
                          <View style={styles.flex}>
                            <AppText style={styles.placeName}>
                              {picked.name}
                            </AppText>
                            <NumText
                              text={picked.address}
                              style={styles.sheetSub}
                            />
                          </View>
                          {Number.isFinite(picked.distanceM) ? (
                            <NumText
                              text={formatDistance(picked.distanceM)}
                              style={styles.distance}
                            />
                          ) : null}
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
              </ThemeProvider>
            </LightGlass>
          </View>
        </KeyboardLift>
      </View>
    </ThemeProvider>
  );
}

// The search results' rows: the glass's own light tone made opaque, so map labels and roads do not show
// through the place names (S15P31E105-679).
const resultSurface = '#F2F5F8';

// The sheet's navy, a step above the page navy so it stands off the map's edge.
const sheetNavy = stand.page;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  ground: { backgroundColor: groupLook.mapBackground },
  dimmed: { opacity: 0.45 },
  pinLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // The map keeps the picked point at 44.7% down (377 of 844).
  pin: {
    position: 'absolute',
    top: '44.7%',
    alignItems: 'center',
    // The pin's tip lands on the point; the hint floats above the pin.
    transform: [{ translateY: -42 }],
  },
  // 6.9-HintToast: a navy pill above the pin.
  tip: {
    position: 'absolute',
    bottom: 52,
    width: 250,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    backgroundColor: stand.page,
  },
  tipText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: stand.text,
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

  back: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stand.page,
  },
  search: {
    flex: 1,
    height: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingLeft: 14,
    paddingRight: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: stand.glassLine,
    backgroundColor: stand.page,
  },
  // Without a lineHeight, as in TextField, so the glyphs are not clipped.
  searchInput: {
    flex: 1,
    height: 47,
    fontFamily: typography.input.fontFamily,
    fontSize: 16,
    paddingVertical: 0,
    textAlignVertical: 'center',
    color: stand.text,
  },
  // The glass's rim and shadow kept on the opaque rows so they still stand off the map.
  resultCard: {
    borderWidth: 1,
    borderColor: 'rgba(6,18,22,0.08)',
    boxShadow: '0 6px 20px rgba(30,45,60,0.14)',
  },
  results: {
    gap: spacing.sm,
    marginHorizontal: spacing.screen,
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
  // The sheet's small lines, on the navy.
  sheetSub: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: stand.sub,
  },
  noResult: { padding: spacing.xl, textAlign: 'center' },
  locateNotice: {
    maxWidth: 280,
    marginTop: 8,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: stand.page,
  },
  locateNoticeText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 17,
    color: stand.text,
  },
  locate: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.screen,
    marginTop: 260,
  },

  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // The glass's own bottom corners sit below the screen edge; a mint line along its top.
  sheetGlass: {
    marginBottom: -32,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: stand.meLine,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 7.5,
    backgroundColor: stand.line,
  },
  sheetBody: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    gap: 12,
  },
  nearby: { gap: 6, paddingVertical: 4 },
  // The nearby places as square-cornered choices, the picked one mint.
  nearbyChip: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 8,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: stand.glassLine,
  },
  nearbyChipOn: { borderColor: stand.mint, backgroundColor: stand.mint },
  chipText: {
    fontFamily: fontFamily.black,
    fontSize: 13,
    lineHeight: 17,
    color: stand.text,
  },
  chipTextOn: { color: stand.onMint },
  pickedRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  placeName: {
    fontFamily: fontFamily.black,
    fontSize: 18,
    lineHeight: 24,
    color: stand.text,
  },
  distance: {
    fontFamily: fontFamily.resultExtraBold,
    fontSize: 16,
    lineHeight: 21,
    color: stand.text,
  },
  // 이 위치로 정하기: the mint pill with a navy circle ✓ at its end.
  confirm: {
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    backgroundColor: stand.mint,
  },
  confirmOff: { backgroundColor: 'rgba(255,255,255,0.1)' },
  sheetSolid: { boxShadow: '0 10px 30px rgba(2,5,14,0.28)' },
  confirmContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 24,
    paddingRight: 12,
  },
  confirmText: {
    fontFamily: fontFamily.black,
    fontSize: 16,
    lineHeight: 21,
    color: stand.onMint,
  },
  confirmIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: stand.onMint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.md },
  pinIcon: { width: 44, height: 44 },
});
