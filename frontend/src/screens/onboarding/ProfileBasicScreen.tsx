import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Screen, TextField } from '../../components';
import { errorCode, useRepositories, type Gender } from '../../data';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { fontFamily, useTheme } from '../../theme';
import {
  ErrorNotice,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  SelectField,
  SelectionCard,
  signUpSteps,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import {
  birthDateError,
  daysInMonth,
  digitsOnly,
  isValidNickname,
  nicknameRule,
  parseBirthDate,
  type BirthDateParts,
} from './validation';

// 1.5b lists 2010 down to 1950.
const years = Array.from({ length: 61 }, (_, index) => 2010 - index);
const months = Array.from({ length: 12 }, (_, index) => index + 1);
const pad = (value: number) => String(value).padStart(2, '0');

const genders: { value: Gender; label: string }[] = [
  { value: 'MALE', label: '남성' },
  { value: 'FEMALE', label: '여성' },
];

// U15 errors other than a taken nickname, which shows under the nickname field on 1.5 instead.
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

function splitDate(date: string | undefined): BirthDateParts {
  const [year = '', month = '', day = ''] = (date ?? '').split('-');
  return { year, month, day };
}

const dateParts = [
  { part: 'year', label: '연도', placeholder: 'YYYY', length: 4 },
  { part: 'month', label: '월', placeholder: 'MM', length: 2 },
  { part: 'day', label: '일', placeholder: 'DD', length: 2 },
] as const;

// The handoff's filled figures for 남성 · 여성.
function GenderIcon({ gender }: { gender: Gender }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24">
      <Circle
        cx={12}
        cy={5.2}
        r={2}
        fill="none"
        stroke={onboardingLook.ink}
        strokeWidth={1.8}
      />
      <Path
        d={
          gender === 'MALE'
            ? 'M9.5 9h5l-.7 6h-1.3l-.5 5.5h-1l-.5-5.5H9.5z'
            : 'M10.2 9h3.6l2.2 7h-2.4l-.6 4.5h-2l-.6-4.5H8z'
        }
        fill={onboardingLook.ink}
      />
    </Svg>
  );
}

// The 1.5 · 1.6 footer: one full-width main button; going back is the header's 뒤로 (담당자 결정).
export function StepFooter({
  title,
  disabled,
  onPress,
}: {
  title: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <OnboardingFooter>
      <GoButton title={title} disabled={disabled} onPress={onPress} />
    </OnboardingFooter>
  );
}

// 1.5 초기 설정 — 닉네임 · 성별 (runway-onboarding-handoff 1.5). The birth date follows on 1.5b, which creates the
// account (U15).
export function ProfileBasicScreen() {
  const navigation = useNavigation();
  const { draft, update } = useSignUpDraft();
  const [nickname, setNickname] = useState(
    draft.basic?.nickname ?? draft.profile?.nickname ?? '',
  );
  const [touched, setTouched] = useState(false);
  const [gender, setGender] = useState<Gender | null>(
    draft.basic?.gender ?? draft.profile?.gender ?? null,
  );
  // The nickname U15 rejected as taken on 1.5b; editing it clears the field error.
  const nicknameTaken =
    draft.takenNickname !== null && draft.takenNickname === nickname.trim();
  const nicknameValid = isValidNickname(nickname);
  const ready = nicknameValid && !nicknameTaken && gender;

  const next = () => {
    if (!ready) {
      return;
    }
    update({ basic: { nickname: nickname.trim(), gender } });
    navigateTo(navigation, 'ProfileBirthday');
  };

  // Once the account exists there is no going back to 1.3·1.4.
  const back = draft.accountCreated ? undefined : navigation.goBack;

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={back}
          progress={{ current: 3, total: signUpSteps }}
        />
      }
      footer={<StepFooter title="다음" disabled={!ready} onPress={next} />}
    >
      <RunnerArt />
      <StepTitle
        title="어떻게 "
        muted="불러드릴까요?"
        description="닉네임은 그룹런과 커뮤니티에 표시돼요."
      />
      <TextField
        labelInside
        icon="tag"
        label="닉네임"
        placeholder="2-10자"
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
      <AppText style={styles.label}>성별</AppText>
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {genders.map(option => (
          <SelectionCard
            key={option.value}
            selected={gender === option.value}
            onPress={() => setGender(option.value)}
            accessibilityLabel={option.label}
            style={styles.choice}
          >
            <GenderIcon gender={option.value} />
            <AppText style={styles.choiceText}>{option.label}</AppText>
          </SelectionCard>
        ))}
      </View>
    </Screen>
  );
}

// 1.5b 초기 설정 — 생년월일 (runway-onboarding-handoff 1.5b). Finishing this step creates the account (U15).
export function ProfileBirthdayScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const { holdTokens } = useSession();
  const { draft, update } = useSignUpDraft();
  const { colors } = useTheme();
  // The parts live in the draft as they change (S15P31E105-287), so going back to 1.5 keeps them.
  const initial = draft.birthDateParts ?? splitDate(draft.profile?.birthDate);
  const [birthParts, setBirthParts] = useState(initial);
  const [directInput, setDirectInput] = useState(false);
  const [birthTouched, setBirthTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const year = birthParts.year ? Number(birthParts.year) : null;
  const month = birthParts.month ? Number(birthParts.month) : null;
  const day = birthParts.day ? Number(birthParts.day) : null;
  const birthDate = parseBirthDate(birthParts);
  const dateError = birthDateError(birthParts);
  const changeBirthParts = (changes: Partial<BirthDateParts>) => {
    const next = { ...birthParts, ...changes };
    setBirthParts(next);
    update({ birthDateParts: next });
    setBirthTouched(true);
  };

  const dayCount =
    year && month && month >= 1 && month <= 12 ? daysInMonth(year, month) : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  // The lists pull the day back to the month's last date; typed dates are never clamped.
  const changeSelectedPart = (changes: Partial<BirthDateParts>) => {
    const next = { ...birthParts, ...changes };
    const nextYear = Number(next.year);
    const nextMonth = Number(next.month);
    if (
      nextYear &&
      nextMonth >= 1 &&
      nextMonth <= 12 &&
      Number(next.day) > daysInMonth(nextYear, nextMonth)
    ) {
      next.day = pad(daysInMonth(nextYear, nextMonth));
    }
    changeBirthParts(next);
  };

  const basic = draft.basic;
  const ready = basic && birthDate;

  const submit = async () => {
    if (!ready) {
      return;
    }
    const profile = { ...basic, birthDate };
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
          userId: session.user.id,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
          refreshExpiresAt: session.refreshExpiresAt,
        });
        // Fire and forget: the watch sync must not delay navigation.
        void setWatchHealthConsent(draft.healthDataAccess);
      }
      // The password is not kept once the account exists.
      update({
        profile,
        accountCreated: true,
        password: '',
        takenNickname: null,
      });
      setSaving(false);
      navigateTo(navigation, 'ProfileRunning');
    } catch (error) {
      setSaving(false);
      if (errorCode(error) === 'NICKNAME_DUPLICATED') {
        // The nickname is chosen on 1.5, so that is where it is shown as taken.
        update({ takenNickname: profile.nickname });
        navigation.goBack();
      } else {
        setFailure(describeSignUpError(error));
      }
    }
  };

  return (
    <Screen
      {...onboardingScreen}
      header={
        <OnboardingHeader
          onBack={navigation.goBack}
          progress={{ current: 4, total: signUpSteps }}
        />
      }
      footer={
        <StepFooter title="다음" disabled={!ready || saving} onPress={submit} />
      }
    >
      <RunnerArt />
      <StepTitle title="생일이 " muted="언제예요?" />
      {failure ? <ErrorNotice title={failure} /> : null}
      <AppText style={styles.label}>생년월일</AppText>
      {/* 목록 선택 · 직접 입력 (S15P31E105-287), as the 1.x glass cards. */}
      <View accessibilityRole="radiogroup" style={styles.dateRow}>
        {[false, true].map(direct => (
          <SelectionCard
            key={String(direct)}
            selected={directInput === direct}
            onPress={() => setDirectInput(direct)}
            accessibilityLabel={
              direct ? '생년월일 직접 입력' : '생년월일 목록 선택'
            }
            style={styles.mode}
          >
            <AppText style={styles.modeText}>
              {direct ? '직접 입력' : '목록 선택'}
            </AppText>
          </SelectionCard>
        ))}
      </View>
      {directInput ? (
        <View style={styles.dateRow}>
          {dateParts.map(({ part, label, placeholder, length }) => (
            <View
              key={part}
              style={part === 'year' ? styles.year : styles.flex}
            >
              <TextField
                labelInside
                label={label}
                accessibilityLabel={`생년월일 ${label} 입력`}
                accessibilityHint="연도 4자리와 월·일을 숫자로 입력해 주세요"
                placeholder={placeholder}
                keyboardType="number-pad"
                value={birthParts[part]}
                onChangeText={value =>
                  changeBirthParts({
                    [part]: digitsOnly(value).slice(0, length),
                  })
                }
                onBlur={() => setBirthTouched(true)}
                status={birthTouched && dateError ? 'error' : 'default'}
              />
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.dateRow}>
          <SelectField
            glass
            label="연도"
            placeholder="연도"
            value={year}
            options={years}
            format={value => `${value}년`}
            onChange={value => changeSelectedPart({ year: String(value) })}
            style={styles.year}
          />
          <SelectField
            glass
            label="월"
            placeholder="월"
            value={month}
            options={months}
            format={value => `${pad(value)}월`}
            onChange={value => changeSelectedPart({ month: pad(value) })}
            style={styles.flex}
          />
          <SelectField
            glass
            label="일"
            placeholder="일"
            value={day}
            options={days}
            format={value => `${pad(value)}일`}
            onChange={value => changeBirthParts({ day: pad(value) })}
            style={styles.flex}
          />
        </View>
      )}
      {/* The format hint and the padlock note are gone (담당자 결정); a wrong date still says why. */}
      {birthTouched && dateError ? (
        <AppText
          accessibilityLiveRegion="polite"
          style={[styles.hint, { color: colors.danger }]}
        >
          {dateError}
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: {
    marginTop: 4,
    paddingHorizontal: 4,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: onboardingLook.label,
  },
  choices: { gap: 12 },
  choice: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  choiceText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: onboardingLook.ink,
  },
  dateRow: { flexDirection: 'row', gap: 8 },
  mode: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeText: {
    fontFamily: fontFamily.medium,
    fontSize: 13.5,
    lineHeight: 18,
    color: onboardingLook.ink,
  },
  hint: {
    paddingHorizontal: 4,
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 17,
    color: onboardingLook.sub,
  },
  year: { flex: 1.4 },
});
