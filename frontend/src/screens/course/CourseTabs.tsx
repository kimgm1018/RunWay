import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, IconButton } from '../../components';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, spacing, ThemeProvider, useTheme } from '../../theme';

type Tab = 'TodayRun' | 'SavedCourses';

const tabs: { value: Tab; label: string }[] = [
  { value: 'TodayRun', label: '추천' },
  { value: 'SavedCourses', label: '저장한 코스' },
];

function TabLabels({ current }: { current: Tab }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map(tab => {
        const selected = tab.value === current;
        return (
          <Pressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => !selected && navigateTo(navigation, tab.value)}
            hitSlop={8}
            style={styles.tab}
          >
            <AppText
              style={[
                styles.label,
                { color: selected ? colors.text : colors.textSecondary },
              ]}
            >
              {tab.label}
            </AppText>
            {/* The picked tab is underlined (DESIGN.md 2-7 머리에 탭). */}
            <View
              style={[
                styles.underline,
                selected && { backgroundColor: colors.text },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// The 추천 | 저장한 코스 tabs at the top of 3.1 and 3.1c, with the back button.
// onDark: 3.1 puts them on the dark map card, so the labels turn white.
export function CourseTabs({
  current,
  onDark = false,
}: {
  current: Tab;
  onDark?: boolean;
}) {
  const navigation = useNavigation();
  return (
    <View style={styles.row}>
      <IconButton
        icon="back"
        accessibilityLabel="뒤로"
        onPress={navigation.goBack}
        diameter={42}
      />
      <ThemeProvider tone={onDark ? 'dark' : 'light'}>
        <TabLabels current={current} />
      </ThemeProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tabs: { flexDirection: 'row', gap: spacing.xxl },
  tab: { paddingTop: 6 },
  label: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 22 },
  underline: { height: 2, borderRadius: 1, marginTop: 6 },
});
