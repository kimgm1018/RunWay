import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';
import {
  AppText,
  Backdrop,
  Button,
  Card,
  EmptyState,
  Icon,
  useToast,
} from '../../components';
import {
  useRepositories,
  useResource,
  type Repositories,
  type SavedCourse,
} from '../../data';
import { formatKm } from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, palette, spacing, useTheme } from '../../theme';
import { CourseTabs } from './CourseTabs';

const loadSaved = (repositories: Repositories) =>
  repositories.courses.getSaved();

// The course's outline as a white line with a faint white halo (DESIGN.md 2-7 코스 카드).
export function CourseGlyph({ shape }: { shape: [number, number][] }) {
  const points = shape.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  const [startX, startY] = shape[0];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      <Polyline
        points={points}
        fill="none"
        stroke={palette.white}
        strokeOpacity={0.18}
        strokeWidth={9}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Polyline
        points={points}
        fill="none"
        stroke={palette.white}
        strokeWidth={3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle
        cx={startX * 100}
        cy={startY * 100}
        r={3.5}
        fill={palette.white}
      />
    </Svg>
  );
}

function SavedCard({
  course,
  onOpen,
  onUnsave,
}: {
  course: SavedCourse;
  onOpen: () => void;
  onUnsave: () => void;
}) {
  const title = course.myAlias ?? course.name;
  return (
    <Card
      variant="course"
      accessibilityLabel={`${title}, ${formatKm(course.distanceM, 1)}km ${
        course.expectedMinutes
      }분`}
      onPress={onOpen}
      style={styles.card}
    >
      <SavedCardContent title={title} course={course} onUnsave={onUnsave} />
    </Card>
  );
}

// Inside the course card, read in the dark tone.
function SavedCardContent({
  title,
  course,
  onUnsave,
}: {
  title: string;
  course: SavedCourse;
  onUnsave: () => void;
}) {
  const { colors } = useTheme();
  return (
    <>
      <View style={styles.glyph}>
        <CourseGlyph shape={course.shape} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 저장 해제`}
        hitSlop={8}
        onPress={onUnsave}
        style={[styles.bookmark, { backgroundColor: colors.surfaceMuted }]}
      >
        <Icon name="bookmark" color={colors.text} size={14} />
      </Pressable>
      <View style={styles.text}>
        <AppText style={styles.cardTitle} numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" style={styles.meta}>
          {`${formatKm(course.distanceM, 1)} km · ${course.expectedMinutes}분`}
        </AppText>
      </View>
    </>
  );
}

// 3.1c 저장한 코스: my bookmarked courses, titled with my own nickname.
export function SavedCoursesScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { courses } = useRepositories();
  const toast = useToast();
  const resource = useResource(useCallback(loadSaved, []));
  const [items, setItems] = useState<SavedCourse[] | null>(null);
  useEffect(() => {
    if (resource.status === 'ready') {
      setItems(resource.data);
    }
  }, [resource.status, resource.data]);

  const open = async (course: SavedCourse) => {
    await courses.choose(course.id);
    navigateTo(navigation, 'CourseRun');
  };
  const unsave = async (course: SavedCourse) => {
    const before = items ?? [];
    setItems(before.filter(item => item.id !== course.id));
    await courses.unsave(course.id);
    toast('저장을 해제했어요', {
      actionLabel: '되돌리기',
      onAction: async () => {
        await courses.save(course.id);
        setItems(before);
      },
    });
  };

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.root, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <CourseTabs current="SavedCourses" />
      <ScrollView contentContainerStyle={styles.content}>
        <AppText style={styles.title} accessibilityRole="header">
          저장한 코스
        </AppText>
        {resource.status === 'loading' ? (
          <ActivityIndicator />
        ) : resource.status === 'error' ? (
          <View style={styles.error}>
            <AppText tone="danger">저장한 코스를 불러오지 못했어요</AppText>
            <Button
              title="다시 시도"
              variant="secondary"
              size="small"
              onPress={resource.reload}
            />
          </View>
        ) : items?.length === 0 ? (
          <EmptyState
            icon="bookmark"
            title="저장한 코스가 없어요"
            description="추천 코스에서 북마크를 누르면 여기에 모여요."
            actionLabel="코스 추천 받기"
            onAction={() => navigateTo(navigation, 'TodayRun')}
          />
        ) : (
          <View style={styles.grid}>
            {items?.map(course => (
              <SavedCard
                key={course.id}
                course={course}
                onOpen={() => open(course)}
                onUnsave={() => unsave(course)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 14, gap: spacing.xl },
  title: {
    fontFamily: fontFamily.regular,
    fontSize: 23,
    lineHeight: 31,
    letterSpacing: -0.5,
    paddingHorizontal: spacing.xs,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  // Two per row, as in the prototype; the course card has corners of 26 (DESIGN.md 2-7).
  card: {
    width: '48.5%',
    borderRadius: 26,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    gap: spacing.md,
  },
  glyph: { width: '100%', aspectRatio: 1, padding: spacing.lg },
  bookmark: {
    position: 'absolute',
    top: spacing.lg,
    right: spacing.lg,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { gap: 2 },
  cardTitle: { fontFamily: fontFamily.medium, fontSize: 15, lineHeight: 21 },
  meta: { fontFamily: fontFamily.numberMedium, fontSize: 13 },
  error: { alignItems: 'center', gap: spacing.md },
});
