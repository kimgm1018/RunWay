import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { IconButton, Segmented } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { spacing, useTheme } from '../../theme';

type Tab = 'TodayRun' | 'SavedCourses';

const tabs: { value: Tab; label: string }[] = [
  { value: 'TodayRun', label: '추천' },
  { value: 'SavedCourses', label: '저장한 코스' },
];

// The 추천 | 저장한 코스 switch at the top of 3.1 and 3.1c, with the back button.
export function CourseTabs({ current }: { current: Tab }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <IconButton
        icon="back"
        accessibilityLabel="뒤로"
        onPress={navigation.goBack}
      />
      <View style={[styles.tabs, { backgroundColor: colors.surface }]}>
        <Segmented
          options={tabs}
          value={current}
          onChange={tab => tab !== current && navigateTo(navigation, tab)}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
    paddingVertical: spacing.md,
  },
  tabs: { flex: 1, borderRadius: 999 },
});
