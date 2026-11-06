import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, {
  Defs,
  LinearGradient,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import {
  AppText,
  BottomSheet,
  Button,
  Icon,
  MistFill,
  TextField,
  useToast,
  type IconName,
} from '../../components';
import { KeyboardLift } from '../../components/KeyboardLift';
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
import { fontFamily, k1, spacing } from '../../theme';
import { parseClock } from '../onboarding/validation';
import { ErrorNotice } from '../onboarding/parts';
import { RunMap } from '../../components/RunMap';
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
import { RangeSlider } from './RangeSlider';
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
const SEARCH_DELAY_MS = 300;

// 환경 chips on the dark half of the mist card: picked ones are filled pale, the rest outlined.
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

// 완주 시간 | 페이스 on the mist card: a dark track with the picked side pale.
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

// 코스 추천 받기 and 6.5 준비 완료: a navy pill with a white glow on the left and a white round icon
// on the right (DESIGN.md 2-7 주 버튼). Its size is fixed, so the glow is drawn at numbers.
const glowWidth = 360;
const glowHeight = 58;

export function GlowButton({
  title,
  loading = false,
  disabled = false,
  icon = 'plus',
  tone = 'navy',
  onPress,
}: {
  title: string;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
  // teal: 3.1 코스 추천 받기 of runway-course-handoff, a deep teal glow on a teal-to-black pill.
  tone?: 'navy' | 'teal';
  onPress: () => void;
}) {
  const teal = tone === 'teal';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glow,
        teal && styles.glowTeal,
        (disabled || loading) && styles.dim,
        pressed && styles.pressed,
      ]}
    >
      <Svg
        style={StyleSheet.absoluteFill}
        width={glowWidth}
        height={glowHeight}
      >
        <Defs>
          {teal ? (
            <>
              <LinearGradient id="glowTealBase" x1="0" y1="0" x2="1" y2="0">
                <Stop offset={0} stopColor="#182E3D" />
                <Stop offset={0.7} stopColor="#091019" />
                <Stop offset={1} stopColor="#060606" />
              </LinearGradient>
              <RadialGradient
                id="glowTeal"
                cx={0.22}
                cy={0.5}
                fx={0.22}
                fy={0.5}
                rx={0.5}
                ry={1.3}
              >
                <Stop offset={0} stopColor="#5D8194" />
                <Stop offset={0.45} stopColor="#3A5A6C" />
                <Stop offset={1} stopColor="#182E3D" stopOpacity={0} />
              </RadialGradient>
            </>
          ) : (
            <RadialGradient
              id="glow"
              cx={0.22}
              cy={0.5}
              fx={0.22}
              fy={0.5}
              rx={0.4}
              ry={1.1}
            >
              <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0.28} />
              <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
          )}
        </Defs>
        {teal ? (
          <Rect
            width={glowWidth}
            height={glowHeight}
            fill="url(#glowTealBase)"
          />
        ) : null}
        <Rect
          width={glowWidth}
          height={glowHeight}
          fill={teal ? 'url(#glowTeal)' : 'url(#glow)'}
        />
      </Svg>
      <AppText style={[styles.glowLabel, teal && styles.glowLabelTeal]}>
        {title}
      </AppText>
      <View style={styles.glowRound}>
        {loading ? (
          <ActivityIndicator color={k1.night} />
        ) : (
          <Icon name={icon} color={k1.night} size={18} />
        )}
      </View>
    </Pressable>
  );
}

// The card's rules: ink on the light half, pale on the dark half.
function Divider({ light = false }: { light?: boolean }) {
  return <View style={[styles.divider, light && styles.dividerLight]} />;
}

// 3.1 오늘의 러닝 and 3.1p (the same screen with 페이스 picked): set the conditions for course recommendations.
// runway-course-handoff: the thin-line map fills the screen under the glass tabs, and a sheet rises from the
// bottom with the mist condition card and 코스 추천 받기.
export function TodayRunScreen() {
  const navigation = useNavigation();
  const { courses, groupRuns, phoneLocation } = useRepositories();
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
        dark={false}
        position={place?.position}
        // The place sits above the sheet, under the tabs (142 of 844).
        area={{ top: 0.17, bottom: 0.17 }}
        // The NAVER logo just over the sheet, on the left (S15P31E105-429).
        logo={{ above: 0.715 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView edges={['top']} style={styles.flex}>
        <CourseTabs current="TodayRun" />
        <View style={styles.mapGap}>
          <GlassIconButton
            icon="locate"
            accessibilityLabel="현재 위치로"
            disabled={locating}
            onPress={locate}
            style={styles.locate}
          />
        </View>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          {/* The keyboard lifts 코스 추천 받기 and shrinks the card list above it (S15P31E105-473). */}
          <KeyboardLift style={styles.flex}>
            <ScrollView
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
              <View style={styles.card}>
                <MistFill id="todayRunCard" />
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
                  goalText={goalText}
                  setGoalText={setGoalText}
                  seconds={seconds}
                  derived={derived}
                  preferences={preferences}
                  setPreferences={setPreferences}
                  conditionsDisabled={!preferences || saving || loading}
                />
              </View>
              {preferences?.shape === 'point_to_point' && !destination ? (
                <AppText tone="textSecondary">
                  편도 코스는 도착 위치를 선택해 주세요.
                </AppText>
              ) : null}
              <Button
                title="이 조건을 기본값으로 저장"
                size="small"
                variant="secondary"
                disabled={!preferences || saving || loading}
                onPress={savePreferences}
              />
              {saving ? (
                <AppText tone="textSecondary">기본값 저장 중…</AppText>
              ) : null}
              {notice ? (
                <ErrorNotice title={notice.title} detail={notice.detail} />
              ) : null}
            </ScrollView>
            <SafeAreaView edges={['bottom']} style={styles.footer}>
              <GlowButton
                title="코스 추천 받기"
                tone="teal"
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
            </SafeAreaView>
          </KeyboardLift>
        </View>
      </SafeAreaView>
      <BottomSheet
        visible={picking !== null}
        onClose={() => setPicking(null)}
        title={picking === 'destination' ? '도착 위치' : '기준 위치'}
      >
        {picking === 'origin' ? (
          <Button
            title={locating ? '현재 위치 찾는 중…' : CURRENT_PLACE_NAME}
            variant={
              place?.name === CURRENT_PLACE_NAME ? 'primary' : 'secondary'
            }
            size="medium"
            disabled={locating}
            onPress={() => {
              setPicking(null);
              locate();
            }}
          />
        ) : null}
        <TextField
          accessibilityLabel="장소·주소 검색"
          placeholder="장소·주소 검색"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
        {searchFailed ? (
          <AppText tone="textSecondary">
            장소를 검색하지 못했어요. 잠시 후 다시 시도해 주세요.
          </AppText>
        ) : places && places.length === 0 ? (
          <AppText tone="textSecondary">
            검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.
          </AppText>
        ) : null}
        <ScrollView
          style={styles.places}
          keyboardShouldPersistTaps="handled"
        >
          {(places ?? []).map(item => (
            <Pressable
              key={`${item.name}|${item.address}`}
              accessibilityRole="button"
              accessibilityLabel={`${item.name}, ${item.address}`}
              onPress={() => pickPlace(item)}
              style={({ pressed }) => [styles.placeRow, pressed && styles.dim]}
            >
              <AppText variant="body" numberOfLines={1}>
                {item.name}
              </AppText>
              <AppText tone="textSecondary" numberOfLines={1}>
                {item.address}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

// Everything on the mist card (runway-course-handoff ConditionCard). The light top half is read in ink
// (기준 위치, 목표 거리) and the dark bottom half in pale (목표, 형태, 환경).
function PanelContent({
  place,
  onPickOrigin,
  distanceKm,
  setDistanceKm,
  goal,
  switchGoal,
  goalText,
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
  goalText: string;
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
  return (
    <>
      <View style={styles.originSection}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`기준 위치 ${place?.name ?? ''}`}
          onPress={onPickOrigin}
          style={styles.origin}
        >
          <View style={styles.originIcon}>
            <Icon name="mapPin" color={inkColor} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText style={styles.inkLabel}>기준 위치</AppText>
            <AppText style={styles.originName} numberOfLines={1}>
              {place?.name ??
                (locating ? '위치를 찾는 중이에요' : '기준 위치를 선택해 주세요')}
            </AppText>
          </View>
          <Icon name="forward" color="rgba(17,17,17,0.55)" size={16} />
        </Pressable>
        <Divider />
      </View>

      {preferences?.shape === 'point_to_point' ? (
        <View style={styles.originSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`도착 위치 ${destination?.name ?? '선택'}`}
            onPress={onPickDestination}
            style={styles.origin}
          >
            <View style={styles.originIcon}>
              <Icon name="mapPin" color={inkColor} size={18} />
            </View>
            <View style={styles.flex}>
              <AppText style={styles.inkLabel}>도착 위치</AppText>
              <AppText style={styles.originName} numberOfLines={1}>
                {destination?.name ?? '도착 위치를 선택해 주세요'}
              </AppText>
            </View>
            <Icon name="forward" color="rgba(17,17,17,0.55)" size={16} />
          </Pressable>
          <Divider />
        </View>
      ) : null}
      <View style={styles.distanceSection}>
        <View style={styles.between}>
          <AppText style={styles.inkLabelLarge}>목표 거리</AppText>
          <AppText style={styles.distance}>
            {distanceKm.toFixed(1)}
            <AppText style={styles.distanceUnit}>{' km'}</AppText>
          </AppText>
        </View>
        <RangeSlider
          value={distanceKm}
          min={1}
          // C01 makes courses of 1–15km (courses.md C01 distanceKm).
          max={15}
          step={0.5}
          ticks={[1, 5, 10, 15]}
          onChange={setDistanceKm}
          accessibilityLabel="목표 거리"
          formatValue={value => `${value.toFixed(1)}km`}
          ink={inkColor}
        />
        <Divider />
      </View>

      <View style={styles.goalSection}>
        <View style={styles.between}>
          <AppText style={styles.goalTitle}>
            {goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'}
          </AppText>
          <GoalSwitch value={goal} onChange={switchGoal} />
        </View>
        <View style={styles.goalRow}>
          {/* The field being typed in has the pale rim; the worked-out one only a faint rim. */}
          <View
            style={[
              styles.goalBox,
              { borderColor: seconds ? pale : dangerPale },
            ]}
          >
            <AppText style={styles.goalLabel}>
              {goal === 'TIME' ? '완주 시간 · 입력' : '페이스 · 입력'}
            </AppText>
            <View style={styles.goalInputRow}>
              <TextInput
                accessibilityLabel={
                  goal === 'TIME' ? '목표 완주 시간' : '목표 페이스'
                }
                value={goalText}
                onChangeText={setGoalText}
                keyboardType="numbers-and-punctuation"
                selectionColor={pale}
                style={[styles.goalNumber, styles.goalInput]}
              />
              {goal === 'PACE' ? (
                <AppText style={styles.goalUnit}>/km</AppText>
              ) : null}
            </View>
          </View>
          <View style={[styles.goalBox, styles.goalBoxFaint]}>
            <AppText style={styles.goalLabel}>
              {goal === 'TIME' ? '자동 계산 · 페이스' : '자동 계산 · 완주 시간'}
            </AppText>
            <AppText style={styles.goalNumber} numberOfLines={1}>
              {derived}
              {goal === 'TIME' && seconds ? (
                <AppText style={styles.goalUnit}>/km</AppText>
              ) : null}
            </AppText>
          </View>
        </View>
        <Divider light />
      </View>

      <View style={styles.envSection}>
        <AppText style={styles.envLabel}>코스 형태</AppText>
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
        <AppText style={[styles.envLabel, styles.filterTitle]}>
          환경 · 여러 개 선택
        </AppText>
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
        <AppText style={styles.filterNote}>
          선택하지 않은 조건은 고려하지 않아요.
        </AppText>
      </View>
    </>
  );
}

const inkColor = '#111111';
const pale = '#E8EEF4';
const dangerPale = '#F0A08E';

const styles = StyleSheet.create({
  optionsError: { gap: spacing.md, alignItems: 'flex-start' },
  // The results scroll inside the sheet so it never grows past the screen.
  places: { maxHeight: 280 },
  placeRow: { paddingVertical: spacing.md, gap: 2 },
  root: { flex: 1, backgroundColor: '#F3F5F6' },
  flex: { flex: 1 },
  // The map shows between the tabs and the sheet, with 현재 위치 at its bottom right.
  mapGap: { height: 148, justifyContent: 'flex-end', paddingBottom: 14 },
  locate: { alignSelf: 'flex-end', marginRight: 16 },

  // The sheet rising from the bottom: round at the top only, near-white, a shadow cast upward.
  sheet: {
    flex: 1,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    backgroundColor: 'rgba(246,247,248,0.93)',
    boxShadow: '0 -12px 40px rgba(2,5,14,0.16)',
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginTop: 10,
    backgroundColor: 'rgba(17,17,17,0.16)',
  },
  content: { paddingHorizontal: 15, paddingTop: 42, gap: spacing.xl },
  card: {
    borderRadius: 28,
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
  },
  divider: { height: 1, backgroundColor: 'rgba(17,17,17,0.12)' },
  dividerLight: { backgroundColor: 'rgba(232,238,244,0.22)' },
  originSection: { height: 69, paddingTop: 18, paddingHorizontal: 20 },
  origin: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 12 },
  originIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(17,17,17,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inkLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 11.5,
    lineHeight: 16,
    color: 'rgba(17,17,17,0.55)',
  },
  originName: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: inkColor,
  },
  distanceSection: {
    height: 121,
    paddingHorizontal: 20,
    paddingTop: 12,
    justifyContent: 'space-between',
  },
  between: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inkLabelLarge: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(17,17,17,0.55)',
  },
  distance: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: inkColor,
  },
  distanceUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: 'rgba(17,17,17,0.6)',
  },
  goalSection: { paddingTop: 10, paddingHorizontal: 20, gap: 8 },
  goalTitle: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255,255,255,0.85)',
  },
  switch: {
    height: 32,
    padding: 2,
    borderRadius: 16,
    flexDirection: 'row',
    backgroundColor: 'rgba(6,6,6,0.24)',
  },
  switchItem: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: pale },
  switchText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  switchTextOn: { fontFamily: fontFamily.bold, color: '#02050E' },
  goalRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  goalBox: {
    flex: 1,
    height: 76,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingTop: 11,
    gap: 4,
    backgroundColor: 'rgba(232,238,244,0.04)',
  },
  goalBoxFaint: { borderColor: 'rgba(232,238,244,0.25)' },
  goalLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: 'rgba(232,238,244,0.6)',
  },
  goalInputRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 1,
  },
  goalNumber: {
    fontFamily: fontFamily.numberRegular,
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: 0.5,
    color: pale,
  },
  goalInput: { flex: 1, padding: 0 },
  goalUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    color: 'rgba(232,238,244,0.7)',
  },
  filterTitle: { marginTop: 14 },
  filterNote: { color: pale, fontSize: 12, marginTop: 10 },
  envSection: { paddingTop: 10, paddingHorizontal: 20, paddingBottom: 18 },
  envLabel: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(232,238,244,0.6)',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: {
    height: 36,
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(232,238,244,0.25)',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: pale, borderColor: pale },
  chipText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    lineHeight: 18,
    color: pale,
  },
  chipTextOn: { color: '#02050E' },
  footer: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 8 },
  glow: {
    height: glowHeight,
    borderRadius: glowHeight / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(37,54,73,0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 26,
    paddingRight: 9,
  },
  glowTeal: {
    backgroundColor: '#091019',
    boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
  },
  glowLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: k1.ice,
  },
  glowLabelTeal: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    letterSpacing: -0.4,
  },
  glowRound: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dim: { opacity: 0.5 },
  pressed: { transform: [{ scale: 0.96 }] },
});
