import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AppText,
  BottomSheet,
  Button,
  Icon,
  type IconName,
  PressableScale,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type MeetingPlace,
  type RecommendationPreferences,
  type Place,
  type Repositories,
} from '../../data';
import { formatDuration, formatPace } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, k1, spacing, ThemeProvider, useTheme } from '../../theme';
import { parseClock } from '../onboarding/validation';
import { ErrorNotice } from '../onboarding/parts';
import { RunMap } from '../../components/RunMap';
import { placeNameOf } from '../../data/placeName';
import { CourseTabs } from './CourseTabs';
import { useCourseSearch } from './CourseSearch';
import {
  recommendFailureNotice,
  type RecommendNotice,
} from './recommendFailure';
import {
  CURRENT_PLACE_NAME,
  locationFailureNotice,
  noLocationNotice,
} from './currentLocation';
import { RulerPicker } from '../../components/RulerPicker';
import { formatGoalDuration, goalLimits } from '../run/goal/runGoal';
import { GlassIconButton } from '../../components/GlassIconButton';
import {
  copyCoursePreferences,
  courseShapeOptions,
  courseFilterOptions,
  legacyEnvironmentTypes,
} from '../../data/coursePreferences';

type GoalInput = 'TIME' | 'PACE';

const goalInputs: { value: GoalInput; label: string }[] = [
  { value: 'TIME', label: '완주 시간' },
  { value: 'PACE', label: '페이스' },
];

const loadPreferences = (repositories: Repositories) =>
  repositories.courses.getPreferences();

// 기준·도착 위치는 현재 위치(폰) 또는 장소 검색 결과에서 고른다(S15P31E105-494). 장소 검색은 그룹런 만남 장소와
// 같은 searchPlaces(백엔드 S15P31E105-471)를 쓴다. 입력이 멈춘 뒤에만 검색한다.
// A point tapped on the map has no place name (no reverse geocoding), so it is called this.
const MAP_PLACE_NAME = '지도에서 고른 위치';
const SEARCH_DELAY_MS = 300;

// 환경 chips as 2.0F's goal chip: light pills, the picked ones dark.
function Chip({
  label,
  selected,
  onPress,
  disabled = false,
  role = 'checkbox',
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  role?: 'checkbox' | 'radio';
}) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={
        role === 'radio'
          ? { selected, disabled }
          : { checked: selected, disabled }
      }
      disabled={disabled}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn, disabled && styles.dim]}
    >
      <AppText style={[styles.chipText, selected && styles.chipTextOn]}>
        {label}
      </AppText>
    </Pressable>
  );
}

// 완주 시간 | 페이스: a faint track with the picked side white.
function GoalSwitch({
  value,
  onChange,
}: {
  value: GoalInput;
  onChange: (next: GoalInput) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" style={styles.switch}>
      {goalInputs.map(option => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: on, checked: on }}
            onPress={() => onChange(option.value)}
            style={[styles.switchItem, on && styles.switchOn]}
          >
            <AppText style={[styles.switchText, on && styles.switchTextOn]}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// 코스 추천 받기 as the goal sheet's 러닝 시작: one wide white pill on the navy card (담당자 요청).
// A white box on the navy sheet read in the light tone, so its labels and ruler are navy (담당자 요청).
function WhiteBox({
  style,
  children,
  ...rest
}: ViewProps & { style: StyleProp<ViewStyle> }) {
  return (
    <ThemeProvider tone="light">
      <View {...rest} style={[style, styles.white]}>
        {children}
      </View>
    </ThemeProvider>
  );
}

function StartPill({
  title,
  loading,
  disabled,
  onPress,
}: {
  title: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const inactive = disabled || loading;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={[styles.start, styles.white, inactive && styles.startOff]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={k1.night} />
      ) : (
        <AppText style={[styles.startText, { color: k1.night }]}>
          {title}
        </AppText>
      )}
    </PressableScale>
  );
}

// 3.1 오늘의 러닝 and 3.1p (the same screen with 페이스 picked): set the conditions for course recommendations.
// runway-course-handoff: the thin-line map fills the screen under the glass tabs, and the conditions and 코스 추천
// 받기 sit on one deep navy card at the bottom with white condition cards (담당자 요청).
export function TodayRunScreen() {
  const navigation = useNavigation();
  const { courses, groupRuns, phoneLocation } = useRepositories();
  const { colors } = useTheme();
  const toast = useToast();
  const { search, setSearch } = useCourseSearch();
  const defaults = useResource(useCallback(loadPreferences, []));
  const loadedPreferences = defaults.status === 'ready' ? defaults.data : null;
  const [preferences, setPreferences] =
    useState<RecommendationPreferences | null>(() =>
      search?.filters
        ? { shape: search.shape ?? 'loop', filters: { ...search.filters } }
        : null,
    );
  useEffect(() => {
    if (loadedPreferences)
      setPreferences(
        current => current ?? copyCoursePreferences(loadedPreferences),
      );
  }, [loadedPreferences]);
  const [saving, setSaving] = useState(false);
  const savingPreferences = useRef(false);
  const [destination, setDestination] = useState<Place | null>(
    search?.destination ?? null,
  );
  const [origin, setOrigin] = useState<Place | null>(search?.origin ?? null);
  // Coming back from 3.1b keeps the origin used there; a fresh 3.1 looks for where I am.
  const firstOrigin = useRef(search?.origin ?? null);
  const [locating, setLocating] = useState(false);
  const [locationNotice, setLocationNotice] = useState<RecommendNotice | null>(
    null,
  );
  // 현재 위치: the phone's own fix, never a fixed place. On failure the origin is left as it was.
  const locate = useCallback(async () => {
    if (!phoneLocation) {
      setLocationNotice(noLocationNotice);
      return;
    }
    setLocating(true);
    setLocationNotice(null);
    try {
      const fix = await phoneLocation.current();
      setOrigin({
        name: CURRENT_PLACE_NAME,
        position: [fix.longitude, fix.latitude],
      });
    } catch (error) {
      setLocationNotice(locationFailureNotice(error));
    } finally {
      setLocating(false);
    }
  }, [phoneLocation]);
  useEffect(() => {
    if (!firstOrigin.current) {
      locate();
    }
  }, [locate]);
  const [picking, setPicking] = useState<'origin' | 'destination' | null>(null);
  // 지도에서 선택 (담당자 요청): the sheet steps aside and a tap on the map sets the point, kept with 이 위치로 설정.
  const [mapPicking, setMapPicking] = useState<'origin' | 'destination' | null>(
    null,
  );
  const [mapPoint, setMapPoint] = useState<Place['position'] | null>(null);
  // The places kept from the map (기준·도착), so 지도에서 선택 stays marked whatever the place is called.
  const [mapPlaces, setMapPlaces] = useState<Place[]>([]);
  // Where the tapped point is, from the phone's geocoder (담당자 요청: 좌표 대신 장소); undefined while it is looked up.
  const [mapPointName, setMapPointName] = useState<string | null | undefined>(
    undefined,
  );
  useEffect(() => {
    if (!mapPoint) {
      setMapPointName(undefined);
      return;
    }
    let live = true;
    setMapPointName(undefined);
    placeNameOf(mapPoint).then(name => {
      if (live) setMapPointName(name);
    });
    return () => {
      live = false;
    };
  }, [mapPoint]);
  const openMapPicking = () => {
    setMapPoint(null);
    setMapPicking(picking);
    setPicking(null);
  };
  const keepMapPoint = () => {
    if (!mapPoint) {
      return;
    }
    const value: Place = {
      name: mapPointName ?? MAP_PLACE_NAME,
      position: mapPoint,
    };
    setMapPlaces(kept => [...kept.slice(-1), value]);
    if (mapPicking === 'destination') {
      setDestination(value);
    } else {
      setOrigin(value);
      setLocationNotice(null);
    }
    setMapPicking(null);
    setMapPoint(null);
  };
  const [query, setQuery] = useState('');
  // null until a search answers; [] is 검색 결과 없음.
  const [places, setPlaces] = useState<MeetingPlace[] | null>(null);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    const text = query.trim();
    setSearchFailed(false);
    if (!picking || !text) {
      setPlaces(null);
      return;
    }
    // A later keystroke or closing the sheet drops this answer.
    let live = true;
    const timer = setTimeout(() => {
      groupRuns.searchPlaces(text).then(
        found => {
          if (live) setPlaces(found);
        },
        () => {
          if (!live) return;
          setPlaces(null);
          setSearchFailed(true);
        },
      );
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [groupRuns, picking, query]);
  const openPicker = (kind: 'origin' | 'destination') => {
    setQuery('');
    setPicking(kind);
  };
  const pickPlace = (item: MeetingPlace) => {
    const value: Place = { name: item.name, position: item.position };
    if (picking === 'destination') {
      setDestination(value);
    } else {
      setOrigin(value);
      setLocationNotice(null);
    }
    setPicking(null);
  };
  const [distanceKm, setDistanceKm] = useState(
    search ? search.targetDistanceM / 1000 : 5,
  );
  const [goal, setGoal] = useState<GoalInput>(search?.goalInputType ?? 'TIME');
  const [goalText, setGoalText] = useState(
    search?.goalInputType === 'PACE' && search.targetPaceSecPerKm
      ? formatDuration(search.targetPaceSecPerKm)
      : search?.targetDurationSec
      ? formatDuration(search.targetDurationSec)
      : '30:00',
  );
  const [loading, setLoading] = useState(false);
  const asking = useRef(false);
  const [notice, setNotice] = useState<{
    title: string;
    detail: string;
  } | null>(null);

  const place = origin;
  const seconds = parseClock(goalText);
  // The other half of the goal is worked out from the distance (6′00″ ↔ 30:00 at 5km).
  const derived = seconds
    ? goal === 'TIME'
      ? formatPace(seconds / distanceKm)
      : formatDuration(seconds * distanceKm)
    : '– –';

  const switchGoal = (next: GoalInput) => {
    if (next === goal) {
      return;
    }
    if (seconds) {
      setGoalText(
        formatDuration(
          next === 'PACE' ? seconds / distanceKm : seconds * distanceKm,
        ),
      );
    }
    setGoal(next);
  };

  const savePreferences = async () => {
    if (!preferences || savingPreferences.current || asking.current) return;
    const value = copyCoursePreferences(preferences);
    savingPreferences.current = true;
    setSaving(true);
    try {
      await courses.savePreferences(value);
      toast('추천 기본값을 저장했어요');
    } catch {
      toast('기본값을 저장하지 못했어요. 선택한 조건은 유지돼요');
    } finally {
      savingPreferences.current = false;
      setSaving(false);
    }
  };

  const recommend = async () => {
    // A second tap before the first answer would start another C01 (courses.md: 중복 탭은 막는다).
    if (
      !place ||
      !seconds ||
      !preferences ||
      savingPreferences.current ||
      asking.current ||
      (preferences.shape === 'point_to_point' && !destination)
    ) {
      return;
    }
    asking.current = true;
    const next = {
      origin: place,
      targetDistanceM: Math.round(distanceKm * 1000),
      goalInputType: goal,
      targetDurationSec: goal === 'TIME' ? seconds : null,
      targetPaceSecPerKm: goal === 'PACE' ? seconds : null,
      environmentTypes: legacyEnvironmentTypes(preferences.filters),
      shape: preferences.shape,
      filters: { ...preferences.filters },
      destination: preferences.shape === 'point_to_point' ? destination : null,
    };
    setLoading(true);
    setNotice(null);
    try {
      const found = await courses.recommend(next);
      setLoading(false);
      if (found.courses.length === 0) {
        setNotice({
          title: '조건에 맞는 코스를 찾지 못했어요.',
          detail: '거리나 환경을 바꿔 다시 추천받아 보세요.',
        });
        return;
      }
      setSearch(next, found);
      navigateTo(navigation, 'RecommendedCourses');
    } catch (error) {
      setLoading(false);
      setNotice(recommendFailureNotice(error));
    } finally {
      asking.current = false;
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <RunMap
        position={mapPicking ? mapPoint ?? place?.position : place?.position}
        // The place sits above the sheet, under the tabs (142 of 844).
        area={{ top: 0.17, bottom: 0.17 }}
        // While picking on the map the camera stays where the user put it, so a tap drops the point right there.
        cameraLocked={mapPicking !== null}
        onTapMap={mapPicking ? point => setMapPoint(point) : undefined}
        // The NAVER logo just over the sheet, on the left (S15P31E105-429).
        logo={{ above: 0.715 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Touches outside the tabs, the buttons and the sheet reach the map below (지도에서 선택). */}
      <SafeAreaView
        edges={['top']}
        style={styles.flex}
        pointerEvents="box-none"
      >
        <CourseTabs current="TodayRun" />
        <View style={styles.mapGap} pointerEvents="box-none">
          <GlassIconButton
            icon="locate"
            accessibilityLabel="현재 위치로"
            disabled={locating}
            onPress={locate}
            style={styles.locate}
          />
        </View>
        {mapPicking ? (
          <View style={styles.mapPickArea} pointerEvents="box-none">
            <View style={styles.mapPickBar}>
              <AppText variant="bodyStrong">
                {mapPicking === 'destination'
                  ? '도착 위치를 지도에서 눌러 주세요'
                  : '기준 위치를 지도에서 눌러 주세요'}
              </AppText>
              <AppText tone="textSecondary">
                {!mapPoint
                  ? '지도를 움직여 원하는 곳을 눌러요'
                  : mapPointName === undefined
                  ? '어디인지 찾는 중이에요'
                  : mapPointName ?? MAP_PLACE_NAME}
              </AppText>
              <View style={styles.mapPickButtons}>
                <Button
                  title="취소"
                  variant="secondary"
                  size="medium"
                  style={styles.flex}
                  onPress={() => {
                    setMapPicking(null);
                    setMapPoint(null);
                  }}
                />
                <Button
                  title="이 위치로 설정"
                  size="medium"
                  style={styles.flex}
                  disabled={!mapPoint}
                  onPress={keepMapPoint}
                />
              </View>
            </View>
          </View>
        ) : (
          // The conditions and both buttons on one navy card floating over the map, laid out like 2.0F's bottom card
          // (담당자 요청).
          <SafeAreaView
            edges={['bottom']}
            style={styles.cardArea}
            pointerEvents="box-none"
          >
            {/* A deep navy card (담당자 요청) read in the dark tone, its condition cards white. */}
            <ThemeProvider tone="dark">
              <View style={styles.panel}>
                <AppText variant="title" style={styles.panelTitle}>
                  코스 조건
                </AppText>
                <ScrollView
                  style={styles.panelScroll}
                  contentContainerStyle={styles.content}
                  keyboardShouldPersistTaps="handled"
                >
                  {locationNotice ? (
                    <View style={styles.optionsError}>
                      <ErrorNotice
                        title={locationNotice.title}
                        detail={locationNotice.detail}
                      />
                      {phoneLocation ? (
                        <Button
                          title="현재 위치 다시 찾기"
                          variant="secondary"
                          size="small"
                          disabled={locating}
                          onPress={locate}
                        />
                      ) : null}
                    </View>
                  ) : null}
                  {defaults.status === 'error' ? (
                    <View style={styles.optionsError}>
                      <ErrorNotice
                        title="추천 기본값을 불러오지 못했어요"
                        detail="저장된 조건을 확인한 뒤 추천받을 수 있어요."
                      />
                      <Button
                        title="기본값 다시 불러오기"
                        size="small"
                        variant="secondary"
                        onPress={defaults.reload}
                      />
                    </View>
                  ) : !preferences ? (
                    <ActivityIndicator accessibilityLabel="추천 기본값 불러오는 중" />
                  ) : null}
                  <PanelContent
                    place={place}
                    locating={locating}
                    onPickOrigin={() => openPicker('origin')}
                    destination={destination}
                    onPickDestination={() => openPicker('destination')}
                    distanceKm={distanceKm}
                    setDistanceKm={setDistanceKm}
                    goal={goal}
                    switchGoal={switchGoal}
                    setGoalText={setGoalText}
                    seconds={seconds}
                    derived={derived}
                    preferences={preferences}
                    setPreferences={setPreferences}
                    conditionsDisabled={!preferences || saving || loading}
                  />
                  {preferences?.shape === 'point_to_point' && !destination ? (
                    <AppText style={styles.hint}>
                      편도 코스는 도착 위치를 선택해 주세요.
                    </AppText>
                  ) : null}
                  {notice ? (
                    <ErrorNotice title={notice.title} detail={notice.detail} />
                  ) : null}
                </ScrollView>
                <View style={styles.actions}>
                  <Button
                    title={
                      saving ? '기본값 저장 중…' : '이 조건을 기본값으로 저장'
                    }
                    accessibilityLabel="이 조건을 기본값으로 저장"
                    size="medium"
                    variant="secondary"
                    icon="bookmark"
                    disabled={!preferences || saving || loading}
                    onPress={savePreferences}
                  />
                  <StartPill
                    title="코스 추천 받기"
                    loading={loading}
                    disabled={
                      !place ||
                      !seconds ||
                      !preferences ||
                      saving ||
                      (preferences.shape === 'point_to_point' && !destination)
                    }
                    onPress={recommend}
                  />
                </View>
              </View>
            </ThemeProvider>
          </SafeAreaView>
        )}
      </SafeAreaView>
      {/* The 기준 위치 sheet in the dark tone too (담당자 요청: 패널은 네이비), its cards white like the 코스 조건 card's. */}
      <ThemeProvider tone="dark">
        <BottomSheet
          visible={picking !== null}
          background={k1.night}
          onClose={() => setPicking(null)}
          title={picking === 'destination' ? '도착 위치' : '기준 위치'}
        >
          {/* The same cards as 운동 목표 (담당자 요청): 현재 위치 and 지도에서 선택, then a search field and its results. */}
          {/* White cards on the navy sheet (담당자 요청), read in the light tone so their text is dark. */}
          <ThemeProvider tone="light">
            <View style={styles.list}>
              {picking === 'origin' ? (
                <ConditionRow
                  icon="locate"
                  kicker="내 위치"
                  value={locating ? '현재 위치 찾는 중…' : CURRENT_PLACE_NAME}
                  accessibilityLabel={CURRENT_PLACE_NAME}
                  selected={place?.name === CURRENT_PLACE_NAME}
                  disabled={locating}
                  onPress={() => {
                    setPicking(null);
                    locate();
                  }}
                />
              ) : null}
              <ConditionRow
                icon="mapPin"
                kicker="직접 고르기"
                value="지도에서 선택"
                accessibilityLabel="지도에서 선택"
                selected={mapPlaces.some(
                  kept =>
                    kept === (picking === 'destination' ? destination : place),
                )}
                onPress={openMapPicking}
              />
              <View style={[styles.searchField, styles.whiteCard]}>
                <Icon name="search" color={colors.textSecondary} size={18} />
                <TextInput
                  accessibilityLabel="장소·주소 검색"
                  placeholder="장소·주소 검색"
                  placeholderTextColor={colors.textTertiary}
                  value={query}
                  onChangeText={setQuery}
                  returnKeyType="search"
                  style={[styles.searchInput, { color: colors.text }]}
                />
              </View>
            </View>
          </ThemeProvider>
          {searchFailed ? (
            <AppText tone="textSecondary">
              장소를 검색하지 못했어요. 잠시 후 다시 시도해 주세요.
            </AppText>
          ) : places && places.length === 0 ? (
            <AppText tone="textSecondary">
              검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.
            </AppText>
          ) : null}
          <ThemeProvider tone="light">
            <ScrollView
              style={styles.places}
              contentContainerStyle={styles.placeList}
              keyboardShouldPersistTaps="handled"
            >
              {(places ?? []).map(item => (
                <PressableScale
                  key={`${item.name}|${item.address}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}, ${item.address}`}
                  onPress={() => pickPlace(item)}
                  style={[styles.placeRow, styles.whiteCard]}
                >
                  <View style={[styles.placeIcon, styles.badge]}>
                    <Icon name="mapPin" color={k1.ice} size={15} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {item.name}
                    </AppText>
                    <AppText
                      variant="caption"
                      tone="textSecondary"
                      numberOfLines={1}
                    >
                      {item.address}
                    </AppText>
                  </View>
                </PressableScale>
              ))}
            </ScrollView>
          </ThemeProvider>
        </BottomSheet>
      </ThemeProvider>
    </View>
  );
}

type ConditionDetail = 'distance' | 'goal' | 'shape' | 'environment';

const detailTitles: Record<ConditionDetail, string> = {
  distance: '목표 거리',
  goal: '목표',
  shape: '코스 형태',
  environment: '환경',
};

// One condition as a 운동 목표 card (2.0F's goal sheet, 담당자 요청): an icon in a white circle, a small label, the
// value large and a note under it. Tapping opens its editor.
function ConditionRow({
  icon,
  kicker,
  value,
  note,
  accessibilityLabel,
  selected = false,
  disabled = false,
  onPress,
}: {
  icon: IconName;
  kicker: string;
  value: string;
  note?: string;
  accessibilityLabel: string;
  // The chosen option, outlined with a check on its icon as in 운동 목표.
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.row,
        selected && styles.rowSelected,
        disabled && styles.dim,
      ]}
    >
      <View style={styles.badge}>
        <Icon name={icon} color={k1.ice} size={18} />
        {selected ? (
          <View style={styles.check}>
            <Icon name="check" color="#FFFFFF" size={10} />
          </View>
        ) : null}
      </View>
      <View style={styles.flex}>
        <AppText variant="label" style={styles.rowKicker}>
          {kicker}
        </AppText>
        <AppText style={styles.rowValue} numberOfLines={1}>
          {value}
        </AppText>
        {note ? (
          <AppText variant="label" style={styles.rowNote} numberOfLines={1}>
            {note}
          </AppText>
        ) : null}
      </View>
      <Icon name="forward" color={inkFaint} size={16} />
    </PressableScale>
  );
}

// The 3.1 conditions as 2.0F's 운동 목표 sheet (담당자 요청): a card per condition; a card opens its ruler or chips
// in its place, and 조건 목록 goes back.
function PanelContent({
  place,
  onPickOrigin,
  distanceKm,
  setDistanceKm,
  goal,
  switchGoal,
  setGoalText,
  seconds,
  derived,
  preferences,
  setPreferences,
  conditionsDisabled,
  destination,
  onPickDestination,
  locating,
}: {
  place: Place | null;
  // 현재 위치 is being looked for; otherwise an empty origin asks to be picked.
  locating: boolean;
  onPickOrigin: () => void;
  distanceKm: number;
  setDistanceKm: (value: number) => void;
  goal: GoalInput;
  switchGoal: (next: GoalInput) => void;
  setGoalText: (text: string) => void;
  seconds: number | null;
  derived: string;
  preferences: RecommendationPreferences | null;
  setPreferences: React.Dispatch<
    React.SetStateAction<RecommendationPreferences | null>
  >;
  conditionsDisabled: boolean;
  destination: Place | null;
  onPickDestination: () => void;
}) {
  const { colors } = useTheme();
  const [detail, setDetail] = useState<ConditionDetail | null>(null);
  const ruler = whiteRuler;
  const shapeLabel =
    courseShapeOptions.find(option => option.value === preferences?.shape)
      ?.label ?? '– –';
  const environment = preferences
    ? courseFilterOptions
        .filter(option => preferences.filters[option.key])
        .map(option => option.label)
    : [];

  if (detail) {
    return (
      <View style={styles.detail}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="조건 목록으로"
          onPress={() => setDetail(null)}
          hitSlop={8}
          style={styles.back}
        >
          <Icon name="back" color={colors.textSecondary} size={16} />
          <AppText variant="captionStrong" tone="textSecondary">
            {`조건 목록 · ${detailTitles[detail]}`}
          </AppText>
        </Pressable>
        {detail === 'distance' ? (
          // The same ruler as 운동 목표 (S15P31E105-517): drag sideways, the value big above it.
          <WhiteBox style={styles.field}>
            <AppText variant="label" tone="textSecondary">
              목표 거리
            </AppText>
            <RulerPicker
              label="목표 거리"
              value={distanceKm}
              min={1}
              // C01 makes courses of 1–15km (courses.md C01 distanceKm).
              max={15}
              step={0.5}
              format={value => `${value.toFixed(1)}km`}
              onChange={setDistanceKm}
              {...ruler}
            />
          </WhiteBox>
        ) : null}
        {detail === 'goal' ? (
          <>
            <View style={styles.between}>
              <AppText variant="label" tone="textSecondary">
                {goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'}
              </AppText>
              <GoalSwitch value={goal} onChange={switchGoal} />
            </View>
            {/* 완주 시간 or 페이스 on a ruler; the other half is worked out from the distance (S15P31E105-517). */}
            <WhiteBox style={styles.field}>
              {goal === 'TIME' ? (
                <RulerPicker
                  label="목표 완주 시간"
                  value={(seconds ?? 1800) / 60}
                  min={5}
                  max={180}
                  step={1}
                  format={value => formatGoalDuration(value * 60)}
                  onChange={value => setGoalText(formatDuration(value * 60))}
                  {...ruler}
                />
              ) : (
                <RulerPicker
                  label="목표 페이스"
                  value={seconds ?? 360}
                  {...goalLimits.paceSec}
                  format={value => `${formatPace(value)}/km`}
                  onChange={value => setGoalText(formatDuration(value))}
                  {...ruler}
                />
              )}
            </WhiteBox>
            <WhiteBox style={styles.derived}>
              <AppText style={styles.derivedValue} numberOfLines={1}>
                {derived}
                {goal === 'TIME' && seconds ? '/km' : ''}
              </AppText>
              <AppText variant="label" tone="textSecondary">
                {goal === 'TIME'
                  ? '자동 계산 · 페이스'
                  : '자동 계산 · 완주 시간'}
              </AppText>
            </WhiteBox>
          </>
        ) : null}
        {detail === 'shape' ? (
          <View style={styles.chips} accessibilityRole="radiogroup">
            {courseShapeOptions.map(option => (
              <Chip
                key={option.value}
                label={option.label}
                role="radio"
                selected={preferences?.shape === option.value}
                disabled={conditionsDisabled}
                onPress={() =>
                  setPreferences(current =>
                    current ? { ...current, shape: option.value } : current,
                  )
                }
              />
            ))}
          </View>
        ) : null}
        {detail === 'environment' ? (
          <View style={styles.chips}>
            {courseFilterOptions.map(option => (
              <Chip
                key={option.key}
                label={option.label}
                selected={preferences?.filters[option.key] ?? false}
                disabled={conditionsDisabled}
                onPress={() =>
                  setPreferences(current =>
                    current
                      ? {
                          ...current,
                          filters: {
                            ...current.filters,
                            [option.key]: !current.filters[option.key],
                          },
                        }
                      : current,
                  )
                }
              />
            ))}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      <ConditionRow
        icon="mapPin"
        kicker="기준 위치"
        value={
          place?.name ??
          (locating ? '위치를 찾는 중이에요' : '기준 위치 설정하기')
        }
        accessibilityLabel={`기준 위치 ${place?.name ?? ''}`}
        onPress={onPickOrigin}
      />
      {preferences?.shape === 'point_to_point' ? (
        <ConditionRow
          icon="mapPin"
          kicker="도착 위치"
          value={destination?.name ?? '도착 위치 설정하기'}
          accessibilityLabel={`도착 위치 ${destination?.name ?? '선택'}`}
          onPress={onPickDestination}
        />
      ) : null}
      <ConditionRow
        icon="route"
        kicker="목표 거리"
        value={`${distanceKm.toFixed(1)}km`}
        accessibilityLabel="목표 거리 설정"
        onPress={() => setDetail('distance')}
      />
      <ConditionRow
        icon="clock"
        kicker={goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'}
        value={
          seconds
            ? goal === 'TIME'
              ? formatGoalDuration(seconds)
              : `${formatPace(seconds)}/km`
            : '– –'
        }
        note={
          goal === 'TIME'
            ? `페이스 ${derived}${seconds ? '/km' : ''}`
            : `예상 완주 ${derived}`
        }
        accessibilityLabel="목표 설정"
        onPress={() => setDetail('goal')}
      />
      <ConditionRow
        icon="compass"
        kicker="코스 형태"
        value={shapeLabel}
        accessibilityLabel="코스 형태 설정"
        onPress={() => setDetail('shape')}
      />
      <ConditionRow
        icon="trend"
        kicker="환경 · 여러 개 선택"
        value={environment.length ? environment.join(' · ') : '선택 안 함'}
        accessibilityLabel="환경 설정"
        onPress={() => setDetail('environment')}
      />
    </View>
  );
}

const inkColor = '#111111';
const inkFaint = 'rgba(17,17,17,0.35)';
// Ink on the white condition cards (담당자 요청).
const inkSub = 'rgba(17,17,17,0.55)';
// Faint text on the navy card.
const iceSub = 'rgba(232,238,244,0.62)';

// Navy value and ticks on the white boxes.
const whiteRuler = { color: k1.night, mutedColor: 'rgba(2,5,14,0.32)' };

const styles = StyleSheet.create({
  white: { backgroundColor: '#FFFFFF' },
  optionsError: { gap: spacing.md, alignItems: 'flex-start' },
  // The results scroll inside the sheet so it never grows past the screen.
  places: { maxHeight: 280 },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  root: { flex: 1, backgroundColor: '#F3F5F6' },
  flex: { flex: 1 },
  // The map shows between the tabs and the sheet, with 현재 위치 at its bottom right.
  mapGap: { height: 148, justifyContent: 'flex-end', paddingBottom: 14 },
  locate: { alignSelf: 'flex-end', marginRight: 16 },

  content: { paddingTop: 2, paddingBottom: 4, gap: spacing.xl },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  switch: {
    height: 32,
    padding: 2,
    borderRadius: 16,
    flexDirection: 'row',
    backgroundColor: 'rgba(232,238,244,0.1)',
  },
  switchItem: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: '#FFFFFF' },
  switchText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: iceSub,
  },
  switchTextOn: { fontFamily: fontFamily.bold, color: inkColor },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: 'rgba(232,238,244,0.1)',
  },
  chipOn: { backgroundColor: '#FFFFFF' },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: k1.ice,
  },
  chipTextOn: { color: k1.night },
  // 2.0F's bottom card 8 from the edges, the conditions scrolling inside it when they run long.
  cardArea: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 8 },
  // The deep navy of 러닝 시작 (담당자 요청), read in the dark tone.
  panel: {
    flexShrink: 1,
    padding: 18,
    gap: 12,
    marginBottom: 8,
    borderRadius: 34,
    backgroundColor: k1.night,
    boxShadow: '0 12px 40px rgba(2,5,14,0.3)',
  },
  panelScroll: { flexGrow: 0, flexShrink: 1 },
  panelTitle: { fontFamily: fontFamily.medium },
  hint: { color: iceSub, fontSize: 13 },
  // White 운동 목표 cards on the navy card (담당자 요청): dark text, a 40 navy icon circle.
  list: { gap: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'transparent',
    backgroundColor: '#FFFFFF',
  },
  whiteCard: { backgroundColor: '#FFFFFF' },
  // The chosen card on the navy sheet: a blue-grey rim that shows against both.
  rowSelected: { borderColor: k1.mid },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.night,
  },
  rowKicker: { color: 'rgba(17,17,17,0.5)' },
  rowNote: { color: inkSub },
  // 17 Bold: a long place or address fits on the line (담당자 요청: 너무 큼).
  rowValue: {
    fontFamily: fontFamily.numberBold,
    fontSize: 17,
    lineHeight: 23,
    color: inkColor,
  },
  check: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.mid,
  },
  // 장소·주소 검색 as a muted box like the cards, the magnifier on its left.
  searchField: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  // No lineHeight: on Android it clips the top of a single-line input.
  searchInput: {
    flex: 1,
    height: 52,
    padding: 0,
    fontFamily: fontFamily.regular,
    fontSize: 15,
    includeFontPadding: false,
  },
  placeList: { gap: 8 },
  placeIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detail: { gap: 12 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  field: { padding: 14, borderRadius: 20, gap: 4 },
  derived: { alignItems: 'center', padding: 12, borderRadius: 20 },
  derivedValue: {
    fontFamily: fontFamily.numberBold,
    fontSize: 26,
    lineHeight: 32,
    color: inkColor,
  },
  // 기본값 저장 over 코스 추천 받기 at the card's foot.
  // 기본값 저장 as the outlined secondary pill over the dark 코스 추천 받기 (담당자 요청: 버튼처럼).
  actions: { gap: 8 },
  // As 2.0F's 러닝 시작: a dark pill, 54 high, a ring with a dot at its right.
  start: {
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startOff: { opacity: 0.45 },
  startText: { fontFamily: fontFamily.bold, fontSize: 17, lineHeight: 22 },
  // 지도에서 선택: a small light bar at the foot instead of the sheet.
  mapPickArea: { flex: 1, justifyContent: 'flex-end' },
  mapPickBar: {
    margin: 14,
    padding: 18,
    gap: 6,
    borderRadius: 28,
    backgroundColor: 'rgba(246,247,248,0.95)',
    boxShadow: '0 -8px 30px rgba(2,5,14,0.16)',
  },
  mapPickButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  dim: { opacity: 0.5 },
});
