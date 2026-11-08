import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, LightGlass } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily } from '../../theme';
import { BackGlassButton } from '../records/look';

type Tab = 'TodayRun' | 'SavedCourses';

const tabs: { value: Tab; label: string }[] = [
  { value: 'TodayRun', label: '추천' },
  { value: 'SavedCourses', label: '저장한 코스' },
];

const ink = '#111111';

// The 추천 | 저장한 코스 tabs at the top of 3.1 and 3.1c (runway-course-handoff MapHeader): a 48 light glass
// pill with two equal tabs, the picked one black. They sit in the same place on both screens, after a round glass
// 뒤로 at the top left (담당자 결정) that leaves the flow.
export function CourseTabs({ current }: { current: Tab }) {
  const navigation = useNavigation();
  return (
    <View style={styles.row}>
      <BackGlassButton
        onPress={() =>
          navigation.canGoBack()
            ? navigation.goBack()
            : navigateTo(navigation, 'Home')
        }
      />
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: 14,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pill: {
    flex: 1,
    height: 48,
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
