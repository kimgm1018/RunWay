import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, LightGlass } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';

type Tab = 'TodayRun' | 'SavedCourses';

const tabs: { value: Tab; label: string }[] = [
  { value: 'TodayRun', label: '추천' },
  { value: 'SavedCourses', label: '저장한 코스' },
];

const ink = '#111111';

// The 추천 | 저장한 코스 tabs at the top of 3.1 and 3.1c (runway-course-handoff MapHeader): a 48 light glass
// pill with two equal tabs, the picked one black. They sit in the same place on both screens. There is no
// back button; the system back leaves the flow.
export function CourseTabs({ current }: { current: Tab }) {
  const navigation = useNavigation();
  return (
    <LightGlass radius={24} accessibilityRole="tablist" style={styles.pill}>
      {tabs.map(tab => {
        const selected = tab.value === current;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => !selected && navigateTo(navigation, tab.value)}
            style={[styles.tab, selected && styles.selected]}
          >
            <AppText style={[styles.label, selected && styles.selectedLabel]}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </LightGlass>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 48,
    marginHorizontal: 14,
    marginTop: 12,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  tab: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: ink },
  label: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: ink,
  },
  selectedLabel: { color: '#FFFFFF' },
});
