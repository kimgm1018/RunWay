import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Screen, TextField } from '../../components';
import { errorCode, useRepositories, type Gender } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing } from '../../theme';
import {
  ErrorNotice,
  OnboardingHeader,
  Segmented,
  SelectField,
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

function splitDate(date: string | undefined) {
  const [year, month, day] = (date ?? '').split('-').map(Number);
  return year ? { year, month, day } : { year: null, month: null, day: null };
}

// 1.5 초기 설정 1/2 — 기본 프로필. Finishing this step creates the account (U15).
export function ProfileBasicScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
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

  const dayCount = year && month ? daysInMonth(year, month) : 31;
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  // Moving to a shorter month pulls the day back to its last date.
  const changeMonthOrYear = (nextYear: number | null, nextMonth: number | null) => {
    setYear(nextYear);
    setMonth(nextMonth);
    if (day && nextYear && nextMonth) {
      setDay(Math.min(day, daysInMonth(nextYear, nextMonth)));
    }
  };

  const nicknameValid = isValidNickname(nickname);
  const ready = nicknameValid && gender && year && month && day;

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
        await repositories.auth.signUp({
          loginId: draft.loginId,
          password: draft.password,
          phoneNumber: draft.phoneNumber,
          healthDataAccess: draft.healthDataAccess,
          ...profile,
        });
      }
      // The password is not kept once the account exists.
      update({ profile, accountCreated: true, password: '' });
      setSaving(false);
      navigateTo(navigation, 'ProfileRunning');
    } catch (error) {
      setSaving(false);
      setFailure(
        errorCode(error) === 'LOGIN_ID_DUPLICATED'
          ? '그사이 다른 사람이 이 아이디로 가입했어요. 회원가입에서 아이디를 바꿔 주세요.'
          : '가입하지 못했어요. 잠시 후 다시 시도해 주세요.',
      );
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
        <>
          {back ? (
            <Button
              title="이전"
              variant="secondary"
              style={styles.flex}
              onPress={back}
            />
          ) : null}
          <Button
            title="다음"
            variant="inverse"
            disabled={!ready}
            loading={saving}
            style={styles.flex}
            onPress={submit}
          />
        </>
      }
    >
      <StepTitle title={'어떻게\n불러드릴까요?'} />
      {failure ? <ErrorNotice title={failure} /> : null}
      <TextField
        label="닉네임"
        value={nickname}
        onChangeText={setNickname}
        onBlur={() => setTouched(true)}
        maxLength={10}
        status={touched && nickname && !nicknameValid ? 'error' : 'default'}
        helper={
          touched && nickname && !nicknameValid
            ? '닉네임은 2–10자로 입력해 주세요'
            : nicknameRule
        }
      />
      <View style={styles.group}>
        <AppText variant="captionStrong" tone="textSecondary">
          성별
        </AppText>
        <Segmented options={genders} value={gender} onChange={setGender} />
      </View>
      <View style={styles.group}>
        <AppText variant="captionStrong" tone="textSecondary">
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
        <AppText variant="caption" tone="textTertiary">
          성별·생년월일은 심박 구간과 권장 페이스 계산에 쓰여요
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: spacing.md },
  row: { flexDirection: 'row', gap: spacing.md },
  year: { flex: 1.4 },
});
