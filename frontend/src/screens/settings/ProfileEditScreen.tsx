import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  EmptyState,
  Icon,
  Segmented,
  TextField,
  useToast,
} from '../../components';
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
import { fontFamily, k1, radius, spacing, ThemeProvider } from '../../theme';
import { SelectField } from '../onboarding/parts';
import {
  daysInMonth,
  isValidNickname,
  nicknameRule,
  toBirthDate,
} from '../onboarding/validation';
import { ProfilePhoto } from './SettingsScreen';

const years = Array.from({ length: 61 }, (_, index) => 2010 - index);
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

function Label({ children }: { children: string }) {
  return (
    <AppText variant="caption" tone="textSecondary" style={styles.label}>
      {children}
    </AppText>
  );
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
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xxxl,
          },
        ]}
      >
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="취소"
            onPress={() => navigation.goBack()}
            style={[styles.pill, styles.cancel]}
          >
            <AppText variant="bodyStrong">취소</AppText>
          </Pressable>
          <AppText style={styles.title} accessibilityRole="header">
            프로필 수정
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="저장"
            accessibilityState={{ disabled: !valid || busy }}
            disabled={!valid || busy}
            onPress={save}
            style={[styles.pill, styles.save, (!valid || busy) && styles.dim]}
          >
            <AppText variant="bodyStrong" style={{ color: k1.night }}>
              저장
            </AppText>
          </Pressable>
        </View>
        <View style={styles.photoBlock}>
          <View>
            <ProfilePhoto
              nickname={nickname || detail.nickname}
              photo={shownPhoto}
              size={124}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="프로필 사진 바꾸기"
              onPress={pickPhoto}
              style={styles.camera}
            >
              <Icon name="camera" color={k1.night} size={16} />
            </Pressable>
          </View>
          <AppText variant="caption" tone="textSecondary">
            이 사진이 내 프로필 배경이 돼요
          </AppText>
        </View>

        <Label>닉네임</Label>
        <TextField
          accessibilityLabel="닉네임"
          value={nickname}
          onChangeText={setNickname}
          maxLength={10}
          status={valid ? 'default' : 'error'}
          helper={
            nicknameTaken
              ? '이미 사용 중인 닉네임이에요'
              : valid
              ? undefined
              : nicknameRule
          }
        />

        <Label>성별</Label>
        <Segmented options={genders} value={gender} onChange={setGender} />

        <Label>생년월일</Label>
        <View style={styles.dateRow}>
          <SelectField
            label="연도"
            placeholder="연도"
            value={year}
            options={years}
            format={value => `${value}년`}
            onChange={value => changeMonthOrYear(value, month)}
            style={styles.flex}
          />
          <SelectField
            label="월"
            placeholder="월"
            value={month}
            options={months}
            format={value => `${pad(value)}월`}
            onChange={value => changeMonthOrYear(year, value)}
            style={styles.flex}
          />
          <SelectField
            label="일"
            placeholder="일"
            value={day}
            options={days}
            format={value => `${pad(value)}일`}
            onChange={setDay}
            style={styles.flex}
          />
        </View>

        <Label>러닝 수준</Label>
        <Segmented options={levels} value={level} onChange={setLevel} />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`기본 목표 · 평소 페이스 ${baselineLine(detail)}`}
          onPress={() => toast('기본 목표와 평소 페이스 수정은 준비 중이에요')}
          style={styles.baseline}
        >
          <View style={styles.flex}>
            <AppText variant="caption" tone="textSecondary">
              기본 목표 · 평소 페이스
            </AppText>
            <AppText style={styles.baselineValue}>
              {baselineLine(detail)}
            </AppText>
          </View>
          <View style={styles.round}>
            <Icon name="forward" color={k1.ice} size={16} />
          </View>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const loadAll = (repositories: Repositories) =>
  Promise.all([repositories.profile.getDetail(), repositories.profile.getMe()]);

// 8.2 프로필 수정 (U05 and the running level of U07) on the dark screen, like 7.4b.
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
    <ThemeProvider tone="dark">
      <View style={styles.root}>
        <StatusBar barStyle="light-content" />
        {loaded.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="프로필을 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={loaded.reload}
          />
        ) : !ready || loaded.status !== 'ready' ? (
          <ActivityIndicator style={styles.loading} color={k1.ice} />
        ) : (
          <Form
            detail={loaded.data[0]}
            photo={loaded.data[1].profileImageUrl}
          />
        )}
      </View>
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: k1.night },
  flex: { flex: 1 },
  loading: { marginTop: 120 },
  dim: { opacity: 0.5 },
  content: { paddingHorizontal: spacing.screen, gap: spacing.md },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontFamily: fontFamily.bold, fontSize: 19, lineHeight: 26 },
  pill: {
    height: 38,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    justifyContent: 'center',
  },
  cancel: { borderWidth: 1, borderColor: 'rgba(232,238,244,0.32)' },
  save: { backgroundColor: k1.ice },
  photoBlock: {
    alignItems: 'center',
    gap: spacing.md,
    marginVertical: spacing.lg,
  },
  camera: {
    position: 'absolute',
    right: 0,
    bottom: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: k1.ice,
  },
  label: { marginTop: spacing.lg, marginLeft: spacing.xs },
  dateRow: { flexDirection: 'row', gap: spacing.md },
  baseline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    marginTop: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(232,238,244,0.16)',
    backgroundColor: 'rgba(2,5,14,0.55)',
  },
  baselineValue: {
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
  },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,238,244,0.12)',
  },
});
