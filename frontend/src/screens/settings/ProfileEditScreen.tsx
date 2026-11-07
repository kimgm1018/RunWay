import React, { useEffect, useState } from 'react';
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
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  EmptyState,
  Icon,
  useToast,
} from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  errorCode,
  useRepositories,
  useResource,
  type Gender,
  type PhotoFile,
  type ProfileDetail,
  type Repositories,
  type SelfReportedLevel,
} from '../../data';
import { formatDuration, formatPace } from '../../format';
import { fontFamily, k1 } from '../../theme';
import { SelectField } from '../onboarding/parts';
import {
  birthYearMax,
  birthYearMin,
  daysInMonth,
  isValidNickname,
  nicknameRule,
  toBirthDate,
} from '../onboarding/validation';
import { ProfilePhoto, settingsLook } from './SettingsScreen';
import { KeyboardLift } from '../../components/KeyboardLift';

// The same years as 1.5b (S15P31E105-520), newest first, so a date picked at sign-up always shows here.
const years = Array.from(
  { length: birthYearMax - birthYearMin + 1 },
  (_, index) => birthYearMax - index,
);
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');

const genders: { value: Gender; label: string }[] = [
  { value: 'MALE', label: '남성' },
  { value: 'FEMALE', label: '여성' },
];

const levels: { value: SelfReportedLevel; label: string }[] = [
  { value: 'BEGINNER', label: '초급' },
  { value: 'INTERMEDIATE', label: '중급' },
  { value: 'ADVANCED', label: '상급' },
];

// 5km · 30:00 · 6′00″/km
function baselineLine({ baseline }: ProfileDetail) {
  const parts = [
    baseline.baselineDistanceM
      ? `${baseline.baselineDistanceM / 1000}km`
      : null,
    baseline.baselineDurationSec
      ? formatDuration(baseline.baselineDurationSec)
      : null,
    `${formatPace(baseline.usualPaceSecPerKm)}/km`,
  ];
  return parts.filter(Boolean).join(' · ');
}

const photoLimitBytes = 5 * 1024 * 1024;

// F01 and U05 failures for the photo; the rest of the form is not sent after one.
function describePhotoError(error: unknown) {
  switch (errorCode(error)) {
    case 'FILE_TOO_LARGE':
      return '사진이 너무 커요. 5MB 이하의 사진을 골라 주세요';
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'INVALID_FILE':
    case 'INVALID_IMAGE':
      return '이 사진은 쓸 수 없어요. 다른 JPG나 PNG 사진을 골라 주세요';
    default:
      return '사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요';
  }
}

function Form({
  detail,
  photo,
}: {
  detail: ProfileDetail;
  photo: string | null;
}) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { profile } = useRepositories();
  const [birthYear, birthMonth, birthDay] = detail.birthDate
    .split('-')
    .map(Number);
  const [nickname, setNickname] = useState(detail.nickname);
  const [gender, setGender] = useState<Gender>(detail.gender);
  const [year, setYear] = useState(birthYear);
  const [month, setMonth] = useState(birthMonth);
  const [day, setDay] = useState(birthDay);
  const [level, setLevel] = useState<SelfReportedLevel>(detail.runningLevel);
  // The 연도 · 월 · 일 fields show under the date once it is tapped.
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // A nickname U05 found taken (409) stays marked until it is changed, as on 1.5.
  const [takenNickname, setTakenNickname] = useState<string | null>(null);
  const nicknameTaken = takenNickname === nickname.trim();
  const days = Array.from(
    { length: daysInMonth(year, month) },
    (_, index) => index + 1,
  );
  // Moving to a shorter month pulls the day back to its last date.
  const changeMonthOrYear = (nextYear: number, nextMonth: number) => {
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(current => Math.min(current, daysInMonth(nextYear, nextMonth)));
  };
  const valid = isValidNickname(nickname) && !nicknameTaken;
  // A picked photo shows at once and goes to the server with 저장; once uploaded it is not sent again.
  const [shownPhoto, setShownPhoto] = useState(photo);
  const [pendingPhoto, setPendingPhoto] = useState<PhotoFile | null>(null);

  const pickPhoto = async () => {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      maxWidth: 1080,
      maxHeight: 1080,
      quality: 0.8,
    });
    const asset = result.assets?.[0];
    if (result.didCancel || !asset?.uri) {
      return;
    }
    const type =
      asset.type === 'image/jpeg' || asset.type === 'image/png'
        ? asset.type
        : null;
    // F01 takes jpeg or png up to 5MB.
    if (!type) {
      toast('JPG나 PNG 사진만 쓸 수 있어요');
      return;
    }
    if ((asset.fileSize ?? 0) > photoLimitBytes) {
      toast('5MB 이하의 사진을 골라 주세요');
      return;
    }
    setShownPhoto(asset.uri);
    setPendingPhoto({
      uri: asset.uri,
      type,
      name: asset.fileName ?? `profile.${type === 'image/png' ? 'png' : 'jpg'}`,
    });
  };

  const save = async () => {
    if (!valid) {
      return;
    }
    setBusy(true);
    if (pendingPhoto) {
      try {
        await profile.changePhoto(pendingPhoto);
        setPendingPhoto(null);
      } catch (error) {
        setBusy(false);
        toast(describePhotoError(error));
        return;
      }
    }
    try {
      await profile.updateBasic({
        nickname: nickname.trim(),
        gender,
        birthDate: toBirthDate(year, month, day),
      });
      // U07 with the level alone keeps the saved pace.
      await profile.saveRunningProfile({ selfReportedLevel: level });
      toast('프로필을 저장했어요');
      navigation.goBack();
    } catch (error) {
      setBusy(false);
      switch (errorCode(error)) {
        case 'NICKNAME_DUPLICATED':
          setTakenNickname(nickname.trim());
          break;
        case 'INVALID_PROFILE':
        case 'VALIDATION_ERROR':
          toast(
            '입력한 정보를 확인하지 못했어요. 닉네임·생년월일을 다시 확인해 주세요',
          );
          break;
        default:
          toast('프로필을 저장하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    }
  };

  return (
    <KeyboardLift style={styles.flex}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          프로필 수정
        </AppText>
      </View>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.photoRow}>
          <View>
            <View style={styles.photoRing}>
              <ProfilePhoto
                nickname={nickname || detail.nickname}
                photo={shownPhoto}
                size={76}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="프로필 사진 바꾸기"
              onPress={pickPhoto}
              hitSlop={6}
              style={styles.camera}
            >
              <Icon name="camera" color="#FFFFFF" size={14} />
            </Pressable>
          </View>
          <View style={styles.photoText}>
            <AppText style={styles.photoTitle}>프로필 사진</AppText>
            <AppText style={styles.photoNote}>
              이 사진이 내 프로필 배경이 돼요
            </AppText>
          </View>
        </View>

        <View>
          <View style={styles.field}>
            <Icon
              name="tag"
              color={settingsLook.label}
              size={20}
              strokeWidth={1.8}
            />
            <View style={styles.flex}>
              <AppText style={styles.fieldLabel}>닉네임</AppText>
              <TextInput
                accessibilityLabel="닉네임"
                value={nickname}
                onChangeText={setNickname}
                maxLength={10}
                placeholder="2-10자"
                placeholderTextColor="#8A8A8A"
                selectionColor={settingsLook.ink}
                style={styles.input}
              />
            </View>
          </View>
          {nicknameTaken || !valid ? (
            <AppText style={styles.error}>
              {nicknameTaken ? '이미 사용 중인 닉네임이에요' : nicknameRule}
            </AppText>
          ) : null}
        </View>

        <View>
          <AppText style={styles.groupLabel}>성별</AppText>
          <Choices options={genders} value={gender} onChange={setGender} />
        </View>

        <View>
          {/* One field with the date; a tap opens the 연도 · 월 · 일 under it (담당자 결정: 시안대로). */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`생년월일 ${year}년 ${month}월 ${day}일`}
            accessibilityState={{ expanded: dateOpen }}
            onPress={() => setDateOpen(open => !open)}
            style={({ pressed }) => [styles.field, pressed && styles.pressed]}
          >
            <Icon
              name="calendar"
              color={settingsLook.label}
              size={20}
              strokeWidth={1.8}
            />
            <View style={styles.flex}>
              <AppText style={styles.fieldLabel}>생년월일</AppText>
              <AppText style={styles.fieldValue}>
                {`${year}년 ${month}월 ${day}일`}
              </AppText>
            </View>
            <Icon
              name={dateOpen ? 'chevronDown' : 'forward'}
              color={settingsLook.label}
              size={16}
            />
          </Pressable>
          {dateOpen ? (
            <View style={styles.dateRow}>
              <SelectField
                glass
                label="연도"
                placeholder="연도"
                value={year}
                options={years}
                format={value => `${value}년`}
                onChange={value => changeMonthOrYear(value, month)}
                style={styles.flex}
              />
              <SelectField
                glass
                label="월"
                placeholder="월"
                value={month}
                options={months}
                format={value => `${pad(value)}월`}
                onChange={value => changeMonthOrYear(year, value)}
                style={styles.flex}
              />
              <SelectField
                glass
                label="일"
                placeholder="일"
                value={day}
                options={days}
                format={value => `${pad(value)}일`}
                onChange={setDay}
                style={styles.flex}
              />
            </View>
          ) : null}
        </View>

        <View>
          <AppText style={styles.groupLabel}>러닝 수준</AppText>
          <Choices options={levels} value={level} onChange={setLevel} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`기본 목표 · 평소 페이스 ${baselineLine(detail)}`}
          onPress={() => toast('기본 목표와 평소 페이스 수정은 준비 중이에요')}
          style={({ pressed }) => [styles.field, pressed && styles.pressed]}
        >
          <Icon
            name="target"
            color={settingsLook.label}
            size={20}
            strokeWidth={1.8}
          />
          <View style={styles.flex}>
            <AppText style={styles.fieldLabel}>기본 목표 · 평소 페이스</AppText>
            <AppText style={styles.fieldValue}>{baselineLine(detail)}</AppText>
          </View>
          <Icon name="forward" color={settingsLook.label} size={16} />
        </Pressable>
      </ScrollView>
      {/* 저장 at the foot (담당자 결정: 시안대로); the keyboard lifts it. */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="저장"
          accessibilityState={{ disabled: !valid || busy }}
          disabled={!valid || busy}
          onPress={save}
          style={({ pressed }) => [
            styles.save,
            (!valid || busy) && styles.dim,
            pressed && styles.pressed,
          ]}
        >
          <AppText style={styles.saveText}>저장</AppText>
        </Pressable>
      </View>
    </KeyboardLift>
  );
}

// The 성별 · 러닝 수준 choices: glass boxes in a row, the chosen one white with a navy rim and a check.
function Choices<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.choices} accessibilityRole="radiogroup">
      {options.map(option => {
        const chosen = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: chosen, selected: chosen }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              chosen ? styles.choiceOn : styles.glass,
              pressed && styles.pressed,
            ]}
          >
            {chosen ? (
              <View style={styles.check}>
                <Icon name="check" color="#FFFFFF" size={11} strokeWidth={3} />
              </View>
            ) : null}
            <AppText style={chosen ? styles.choiceTextOn : styles.choiceText}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const loadAll = (repositories: Repositories) =>
  Promise.all([repositories.profile.getDetail(), repositories.profile.getMe()]);

// 8.2 프로필 수정 (U05 and the running level of U07) on the mist (runway-settings, 담당자 결정: 시안대로).
export function ProfileEditScreen() {
  const loaded = useResource(loadAll);
  // The form keeps its own answers once shown, so it mounts only after the profile loads.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (loaded.status === 'ready') {
      setReady(true);
    }
  }, [loaded.status]);
  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      {loaded.status === 'error' ? (
        <EmptyState
          icon="alert"
          title="프로필을 불러오지 못했어요"
          actionLabel="다시 시도"
          onAction={loaded.reload}
        />
      ) : !ready || loaded.status !== 'ready' ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <Form detail={loaded.data[0]} photo={loaded.data[1].profileImageUrl} />
      )}
    </View>
  );
}

// The glass of the 8.2 fields and choices (runway-settings).
const glassFill = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.6)',
  backgroundColor: 'rgba(255,255,255,0.5)',
  boxShadow:
    '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
} as const;

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  dim: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: settingsLook.ink,
  },
  // Fields 24 apart, 24 from the edges.
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 24,
  },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  photoRing: {
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    boxShadow: '0 10px 26px rgba(9,17,26,0.14)',
  },
  camera: {
    position: 'absolute',
    right: -4,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: settingsLook.ink,
  },
  photoText: { gap: 4 },
  photoTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 15.5,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: settingsLook.ink,
  },
  photoNote: {
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  field: {
    height: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingLeft: 18,
    paddingRight: 16,
    borderRadius: 18,
    ...glassFill,
  },
  fieldLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: settingsLook.label,
  },
  fieldValue: {
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    lineHeight: 22,
    color: settingsLook.ink,
  },
  // Noto's tall glyphs need more than the 22 line, so the input keeps its own height without padding.
  input: {
    height: 26,
    padding: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    color: settingsLook.ink,
  },
  error: {
    marginTop: 6,
    marginLeft: 4,
    fontSize: 12.5,
    lineHeight: 17,
    color: k1.coralText,
  },
  groupLabel: {
    paddingLeft: 4,
    marginBottom: 8,
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0.3,
    color: settingsLook.label,
  },
  dateRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  choices: { flexDirection: 'row', gap: 10 },
  choice: {
    flex: 1,
    height: 52,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  glass: glassFill,
  choiceOn: {
    borderWidth: 1.5,
    borderColor: settingsLook.ink,
    backgroundColor: '#FFFFFF',
    boxShadow: '0 12px 28px rgba(9,17,26,0.12)',
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: settingsLook.ink,
  },
  choiceText: {
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: settingsLook.ink,
  },
  choiceTextOn: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: settingsLook.ink,
  },
  footer: { paddingHorizontal: 24, paddingTop: 8 },
  save: {
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#02050D',
  },
  saveText: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 22,
    color: '#FFFFFF',
  },
});
