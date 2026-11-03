import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, IconButton, Screen, TextField } from '../../components';
import { errorCode, useRepositories, type Gender } from '../../data';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { spacing } from '../../theme';
import {
  ErrorNotice,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  PageDots,
  SelectField,
  SelectionCard,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import {
  daysInMonth,
  isValidNickname,
  nicknameRule,
  toBirthDate,
} from './validation';

// 1.5 lists 2010 down to 1950.
const years = Array.from({ length: 61 }, (_, index) => 2010 - index);
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');

const genders: { value: Gender; label: string }[] = [
  { value: 'MALE', label: '남성' },
  { value: 'FEMALE', label: '여성' },
];

// U15 errors other than a taken nickname, which shows under the nickname field instead.
function describeSignUpError(error: unknown) {
  switch (errorCode(error)) {
    case 'LOGIN_ID_DUPLICATED':
      return '그사이 다른 사람이 이 아이디로 가입했어요. 회원가입에서 아이디를 바꿔 주세요.';
    case 'INVALID_PASSWORD_POLICY':
      return '비밀번호가 규칙에 맞지 않아요. 회원가입에서 공백 없이 8~20자로 바꿔 주세요.';
    case 'INVALID_CONSENT':
      return '필수 약관 동의가 확인되지 않았어요. 약관 동의를 다시 해 주세요.';
    case 'INVALID_PROFILE':
    case 'VALIDATION_ERROR':
      return '입력한 정보를 확인하지 못했어요. 닉네임·생년월일·전화번호를 다시 확인해 주세요.';
    case 'NETWORK_ERROR':
      return '가입하지 못했어요. 네트워크 연결을 확인하고 다시 시도해 주세요.';
    default:
      return '가입하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}

function splitDate(date: string | undefined) {
  const [year, month, day] = (date ?? '').split('-').map(Number);
  return year ? { year, month, day } : { year: null, month: null, day: null };
}

// 1.5 초기 설정 1/2 — 기본 프로필. Finishing this step creates the account (U15).
export function ProfileBasicScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const { holdTokens } = useSession();
  const { draft, update } = useSignUpDraft();
  const initial = splitDate(draft.profile?.birthDate);
  const [nickname, setNickname] = useState(draft.profile?.nickname ?? '');
  const [touched, setTouched] = useState(false);
  const [gender, setGender] = useState<Gender | null>(
    draft.profile?.gender ?? null,
  );
  const [year, setYear] = useState<number | null>(initial.year);
  const [month, setMonth] = useState<number | null>(initial.month);
  const [day, setDay] = useState<number | null>(initial.day);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The nickname U15 rejected as taken; editing it clears the field error.
  const [takenNickname, setTakenNickname] = useState<string | null>(null);
  const nicknameTaken =
    takenNickname !== null && takenNickname === nickname.trim();

  const dayCount = year && month ? daysInMonth(year, month) : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  // Moving to a shorter month pulls the day back to its last date.
  const changeMonthOrYear = (
    nextYear: number | null,
    nextMonth: number | null,
  ) => {
    setYear(nextYear);
    setMonth(nextMonth);
    if (day && nextYear && nextMonth) {
      setDay(Math.min(day, daysInMonth(nextYear, nextMonth)));
    }
  };

  const nicknameValid = isValidNickname(nickname);
  const ready =
    nicknameValid && !nicknameTaken && gender && year && month && day;

  const submit = async () => {
    if (!ready) {
      return;
    }
    const profile = {
      nickname: nickname.trim(),
      gender,
      birthDate: toBirthDate(year, month, day),
    };
    setSaving(true);
    setFailure(null);
    try {
      if (draft.accountCreated) {
        await repositories.profile.updateBasic(profile);
      } else {
        const session = await repositories.auth.signUp({
          loginId: draft.loginId,
          password: draft.password,
          phoneNumber: draft.phoneNumber,
          healthDataAccess: draft.healthDataAccess,
          ...profile,
        });
        // Setup is not finished yet, so the tokens stay in memory until 1.7 signs in (users.md 초기 설정과 화면 분기).
        holdTokens({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          refreshExpiresAt: session.refreshExpiresAt,
        });
        // Fire and forget: the watch sync must not delay navigation.
        void setWatchHealthConsent(draft.healthDataAccess);
      }
      // The password is not kept once the account exists.
      update({ profile, accountCreated: true, password: '' });
      setSaving(false);
      navigateTo(navigation, 'ProfileRunning');
    } catch (error) {
      setSaving(false);
      if (errorCode(error) === 'NICKNAME_DUPLICATED') {
        setTakenNickname(profile.nickname);
      } else {
        setFailure(describeSignUpError(error));
      }
    }
  };

  // Once the account exists there is no going back to 1.3·1.4.
  const back = draft.accountCreated ? undefined : navigation.goBack;
  return (
    <Screen
      header={
        <OnboardingHeader onBack={back} step={{ current: 1, total: 2 }} />
      }
      footer={
        <OnboardingFooter>
          <View style={styles.cta}>
            {back ? (
              <IconButton
                icon="back"
                accessibilityLabel="이전"
                diameter={54}
                onPress={back}
              />
            ) : null}
            <GoButton
              title="다음"
              disabled={!ready || saving}
              onPress={submit}
            />
          </View>
          <PageDots count={2} current={0} />
        </OnboardingFooter>
      }
    >
      <StepTitle title="어떻게 " muted="불러드릴까요?" />
      {failure ? <ErrorNotice title={failure} /> : null}
      <TextField
        labelInside
        label="닉네임"
        value={nickname}
        onChangeText={setNickname}
        onBlur={() => setTouched(true)}
        maxLength={10}
        status={
          nicknameTaken || (touched && nickname && !nicknameValid)
            ? 'error'
            : 'default'
        }
        helper={
          nicknameTaken
            ? '이미 사용 중인 닉네임이에요'
            : touched && nickname && !nicknameValid
            ? '닉네임은 2–10자로 입력해 주세요'
            : nicknameRule
        }
      />
      <View style={styles.group}>
        <AppText variant="label" tone="textTertiary" style={styles.label}>
          성별
        </AppText>
        <View accessibilityRole="radiogroup" style={styles.row}>
          {genders.map(option => {
            const selected = gender === option.value;
            return (
              <SelectionCard
                key={option.value}
                selected={selected}
                onPress={() => setGender(option.value)}
                accessibilityLabel={option.label}
                style={styles.gender}
              >
                <AppText variant={selected ? 'bodyMedium' : 'body'}>
                  {option.label}
                </AppText>
              </SelectionCard>
            );
          })}
        </View>
      </View>
      <View style={styles.group}>
        <AppText variant="label" tone="textTertiary" style={styles.label}>
          생년월일
        </AppText>
        <View style={styles.row}>
          <SelectField
            label="연도"
            placeholder="연도"
            value={year}
            options={years}
            format={value => `${value}년`}
            onChange={value => changeMonthOrYear(value, month)}
            style={styles.year}
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
        <AppText variant="caption" tone="textSecondary" style={styles.note}>
          성별·생년월일은 심박 구간과 권장 페이스 계산에 쓰여요
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: spacing.md },
  label: { letterSpacing: 1.4, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  // 성별 is two light pills side by side; the chosen one turns ink (DESIGN.md 2-5).
  gender: {
    flex: 1,
    height: 50,
    padding: 0,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
  },
  year: { flex: 1.4 },
  note: { paddingHorizontal: spacing.md },
  cta: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
});
