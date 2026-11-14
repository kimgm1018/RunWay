import React, { useState } from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, Button, useToast } from '../../components';
import { BackButton } from '../../components/BackButton';
import { KeyboardLift } from '../../components/KeyboardLift';
import { useRepositories } from '../../data';
import type { SatisfactionSurveyAnswer } from '../../data/types';
import { surveyPrompt } from '../../data/survey/surveyPrompt';
import type { RootStackParamList } from '../../navigation/types';
import { fontFamily, k1 } from '../../theme';
import { settingsLook } from './SettingsScreen';

export const surveyCommentLimit = 1000;

type Score = SatisfactionSurveyAnswer['score'];
const scores: { value: Score; label: string }[] = [
  { value: 1, label: '매우 불만' },
  { value: 2, label: '불만' },
  { value: 3, label: '보통' },
  { value: 4, label: '만족' },
  { value: 5, label: '매우 만족' },
];

// 8.1d 만족도 조사 (S15P31E105-813, SV01): 1–5 and an optional comment. Opened from 8.1's tile or from 4.5's prompt
// after a saved run. The scores are numbers and words only, no capsules (DESIGN.md · the team's look); the chosen
// one turns ink and bold. A sent answer also holds 4.5's prompt back for 30 days.
export function SatisfactionSurveyScreen() {
  const navigation = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, 'SatisfactionSurvey'>>();
  const source = route.params?.source ?? 'SETTINGS';
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const { surveys } = useRepositories();
  const [score, setScore] = useState<Score | null>(null);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  // The outcome stays on the screen itself: a toast alone sat under the keyboard and was missed on a real device.
  const send = async () => {
    if (score === null || sending) return;
    Keyboard.dismiss();
    setSending(true);
    setFailed(false);
    try {
      await surveys.submit({ score, comment, source });
      await surveyPrompt.rest('done');
      setSent(true);
      toast('소중한 의견 고마워요');
    } catch {
      setFailed(true);
      toast('보내지 못했어요. 잠시 후 다시 시도해 주세요');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" />
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Backdrop tail />
        </View>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <BackButton onPress={() => navigation.goBack()} />
          <AppText style={styles.title} accessibilityRole="header">
            만족도 조사
          </AppText>
        </View>
        <View style={styles.done} accessibilityLiveRegion="polite">
          <AppText style={styles.doneTitle}>제출 완료</AppText>
          <AppText style={styles.doneBody}>
            소중한 의견 고마워요. 서비스를 다듬는 데 쓸게요.
          </AppText>
        </View>
        <View style={[styles.foot, { paddingBottom: insets.bottom + 16 }]}>
          <Button
            title="확인"
            accessibilityLabel="만족도 조사 닫기"
            onPress={() => navigation.goBack()}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          만족도 조사
        </AppText>
      </View>
      <KeyboardLift style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.content,
            { paddingBottom: insets.bottom + 24 },
          ]}
        >
          <AppText style={styles.question}>
            RunWay를 쓰면서 얼마나 만족하셨나요?
          </AppText>
          <View style={styles.scores} accessibilityRole="radiogroup">
            {scores.map(item => {
              const chosen = item.value === score;
              return (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityLabel={`${item.value}점 ${item.label}`}
                  accessibilityState={{ selected: chosen, checked: chosen }}
                  onPress={() => setScore(item.value)}
                  style={({ pressed }) => [
                    styles.score,
                    pressed && styles.pressed,
                  ]}
                >
                  <AppText
                    style={[styles.scoreValue, chosen && styles.chosenValue]}
                  >
                    {item.value}
                  </AppText>
                  <AppText
                    style={[styles.scoreLabel, chosen && styles.chosenLabel]}
                  >
                    {item.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={styles.section}>더 하고 싶은 말 (선택)</AppText>
          <TextInput
            accessibilityLabel="의견"
            placeholder="좋았던 점이나 아쉬운 점을 알려 주세요"
            placeholderTextColor={settingsLook.sub}
            value={comment}
            onChangeText={setComment}
            maxLength={surveyCommentLimit}
            multiline
            textAlignVertical="top"
            style={styles.comment}
          />
          <AppText style={styles.count}>
            {comment.length}/{surveyCommentLimit}
          </AppText>
          <AppText style={styles.notice}>
            보내 주신 점수와 의견은 서비스 개선에 쓰이며, 회원 탈퇴 후에도 삭제되지 않고 보관돼요.
          </AppText>
        </ScrollView>
        <View style={[styles.foot, { paddingBottom: insets.bottom + 16 }]}>
          {failed ? (
            <AppText style={styles.error} accessibilityLiveRegion="polite">
              보내지 못했어요. 잠시 후 다시 시도해 주세요.
            </AppText>
          ) : null}
          <Button
            title="보내기"
            accessibilityLabel="만족도 보내기"
            onPress={send}
            disabled={score === null}
            loading={sending}
          />
        </View>
      </KeyboardLift>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
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
  content: { paddingHorizontal: 24 },
  question: {
    marginTop: 16,
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: settingsLook.ink,
  },
  scores: {
    marginTop: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  score: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  scoreValue: {
    fontFamily: fontFamily.medium,
    fontSize: 28,
    lineHeight: 34,
    color: settingsLook.sub,
  },
  chosenValue: { fontFamily: fontFamily.bold, color: settingsLook.ink },
  scoreLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  chosenLabel: { fontFamily: fontFamily.bold, color: settingsLook.ink },
  section: {
    marginTop: 32,
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.2,
    color: settingsLook.label,
  },
  comment: {
    marginTop: 12,
    minHeight: 120,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    color: settingsLook.ink,
  },
  count: {
    marginTop: 6,
    alignSelf: 'flex-end',
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 16,
    color: settingsLook.sub,
  },
  notice: {
    marginTop: 16,
    fontFamily: fontFamily.medium,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: settingsLook.sub,
  },
  foot: { paddingHorizontal: 24, paddingTop: 8 },
  error: {
    marginBottom: 8,
    fontFamily: fontFamily.medium,
    fontSize: 13,
    lineHeight: 18,
    color: k1.coralText,
  },
  done: { flex: 1, paddingHorizontal: 24, paddingTop: 40 },
  doneTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: settingsLook.ink,
  },
  doneBody: {
    marginTop: 8,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 22,
    color: settingsLook.label,
  },
});
