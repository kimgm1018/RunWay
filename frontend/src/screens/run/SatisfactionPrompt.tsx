import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BottomSheet, Button } from '../../components';
import {
  surveyPrompt,
  type SurveyPromptOutcome,
} from '../../data/survey/surveyPrompt';
import type { RootStackParamList } from '../../navigation/types';
import { spacing } from '../../theme';

// 4.5's 만족도 조사 prompt (S15P31E105-813): once the run's record is saved, at most once per visit, and only when the
// last answer, close or 나중에 has rested long enough (30 days, or 3 after 나중에). 참여하기 opens 8.1d; a sent answer
// then rests it for 30 days, and leaving 8.1d without sending counts as 나중에. Closing the sheet rests it for 30.
export function SatisfactionPrompt({ ready }: { ready: boolean }) {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [visible, setVisible] = useState(false);
  const asked = useRef(false);

  useEffect(() => {
    if (!ready || asked.current) return;
    asked.current = true;
    let live = true;
    surveyPrompt.isDue().then(due => {
      if (live && due) setVisible(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);

  const finish = (outcome: SurveyPromptOutcome) => {
    setVisible(false);
    surveyPrompt.rest(outcome);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={() => finish('done')}
      title="RunWay는 어떠셨나요?"
      description="1분이면 끝나요. 남겨 주신 의견으로 RunWay를 더 좋게 만들게요."
    >
      <View style={styles.actions}>
        <Button
          title="참여하기"
          accessibilityLabel="만족도 조사 참여하기"
          onPress={() => {
            finish('later');
            navigation.navigate('SatisfactionSurvey', { source: 'RUN_RESULT' });
          }}
        />
        <Button
          title="나중에 하기"
          variant="text"
          accessibilityLabel="만족도 조사 나중에 하기"
          onPress={() => finish('later')}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.md },
});
