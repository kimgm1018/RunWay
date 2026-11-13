import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Svg, { Circle, Path } from 'react-native-svg';
import { AppText, Screen, TextField, WheelPicker } from '../../components';
import { errorCode, useRepositories, type Gender } from '../../data';
import { setWatchHealthConsent } from '../../health/watchHealth';
import { navigateTo } from '../../navigation/navigateTo';
import { useSession } from '../../session/SessionProvider';
import { fontFamily } from '../../theme';
import {
  ErrorNotice,
  GoButton,
  OnboardingFooter,
  OnboardingHeader,
  onboardingLook,
  onboardingScreen,
  RunnerArt,
  SelectionCard,
  signUpSteps,
  StepTitle,
} from './parts';
import { useSignUpDraft } from './SignUpDraft';
import {
  birthDateOptions,
  clampBirthDate,
  defaultBirthDate,
  isValidNickname,
  nicknameError,
  nicknameRule,
  parseBirthDate,
  toBirthDate,
  type BirthDate,
  type BirthDateParts,
} from './validation';

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
      return '비밀번호가 규칙에 맞지 않아요. 회원가입에서 아이디와 다른 영문·숫자·특수문자 8~20자로 바꿔 주세요.';
    case 'INVALID_CONSENT':
      return '필수 약관 동의가 확인되지 않았어요. 약관 동의를 다시 해 주세요.';
    // U15 휴대전화 인증 (users.md, S15P31E105-560): the 10-minute proof ran out, or the number got taken meanwhile.
    case 'VERIFICATION_EXPIRED':
      return '휴대폰 인증 시간이 지났어요. 회원가입에서 전화번호를 다시 인증해 주세요.';
    case 'PHONE_ALREADY_REGISTERED':
      return '이미 가입된 전화번호예요. 로그인하거나 비밀번호를 찾아 주세요.';
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

// A kept date opens the wheels where it was; nothing kept yet opens them on 2002-01-01.
function initialBirthDate(parts: BirthDateParts): BirthDate {
  return parseBirthDate(parts)
    ? clampBirthDate({
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
      })
    : defaultBirthDate;
}

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
  // 공백·허용하지 않는 문자는 입력하는 즉시, 길이 부족은 칸을 벗어난 뒤 안내한다(S15P31E105-781).
  const nicknameProblem = nicknameError(nickname, touched);
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
        onChangeText={text => {
          setNickname(text);
          setTouched(false);
        }}
        onBlur={() => setTouched(true)}
        maxLength={10}
        status={nicknameTaken || nicknameProblem ? 'error' : 'default'}
        helper={
          nicknameTaken
            ? '이미 사용 중인 닉네임이에요'
            : nicknameProblem ?? nicknameRule
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
  // The date lives in the draft as it changes (S15P31E105-287), so going back to 1.5 keeps it.
  const [birth, setBirth] = useState(() =>
    initialBirthDate(
      draft.birthDateParts ?? splitDate(draft.profile?.birthDate),
    ),
  );
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const { years, months, days } = birthDateOptions(birth);
  const birthDate = toBirthDate(birth.year, birth.month, birth.day);
  // A shorter month, or today's month in the latest year, pulls the later wheels back.
  const changeBirth = (changes: Partial<BirthDate>) => {
    const next = clampBirthDate({ ...birth, ...changes });
    setBirth(next);
    update({
      birthDateParts: {
        year: String(next.year),
        month: pad(next.month),
        day: pad(next.day),
      },
    });
  };

  // The wheels always hold a date, so 다음 waits only for 1.5's nickname and gender.
  const basic = draft.basic;

  const submit = async () => {
    if (!basic) {
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
          ...(draft.phoneVerificationToken
            ? { phoneVerificationToken: draft.phoneVerificationToken }
            : {}),
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
        return;
      }
      // A lost U15 success still created the account; LOGIN_ID_DUPLICATED on retry — sign in and continue
      // setup instead of a dead-end "change your id" message (S15P31E105-638).
      if (errorCode(error) === 'LOGIN_ID_DUPLICATED' && !draft.accountCreated) {
        try {
          const session = await repositories.auth.login({
            loginId: draft.loginId,
            password: draft.password,
          });
          holdTokens({
            userId: session.user.id,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            refreshExpiresAt: session.refreshExpiresAt,
          });
          void setWatchHealthConsent(draft.healthDataAccess);
          update({
            profile,
            accountCreated: true,
            password: '',
            takenNickname: null,
          });
          navigateTo(navigation, 'ProfileRunning');
          return;
        } catch {
          // Fall through to the duplicated-id message when login also fails.
        }
      }
      setFailure(describeSignUpError(error));
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
        <StepFooter title="다음" disabled={!basic || saving} onPress={submit} />
      }
    >
      <RunnerArt />
      <StepTitle title="생일이 " muted="언제예요?" />
      {failure ? <ErrorNotice title={failure} /> : null}
      {/* Three wheels in 년 · 월 · 일 order, rolled in place like the reference (S15P31E105-520). */}
      <View style={styles.wheels}>
        <WheelPicker
          label="연도"
          options={years}
          value={birth.year}
          format={value => `${value}년`}
          onChange={year => changeBirth({ year })}
          color={onboardingLook.ink}
          style={styles.year}
        />
        <WheelPicker
          label="월"
          options={months}
          value={birth.month}
          format={value => `${value}월`}
          onChange={month => changeBirth({ month })}
          color={onboardingLook.ink}
          style={styles.flex}
        />
        <WheelPicker
          label="일"
          options={days}
          value={birth.day}
          format={value => `${value}일`}
          onChange={day => changeBirth({ day })}
          color={onboardingLook.ink}
          style={styles.flex}
        />
      </View>
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
  wheels: { flexDirection: 'row', gap: 8, marginTop: 12 },
  year: { flex: 1.4 },
});
