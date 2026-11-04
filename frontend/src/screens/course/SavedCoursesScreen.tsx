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
  EmptyState,
  Icon,
  MistFill,
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
import { fontFamily, palette, spacing } from '../../theme';
import { CourseTabs } from './CourseTabs';

const loadSaved = (repositories: Repositories) =>
  repositories.courses.getSaved();

// The course's outline as a white line with a faint white halo (DESIGN.md 2-7 코스 카드).
// thin: runway-course-handoff 3.1c, a bare thin white line.
export function CourseGlyph({
  shape,
  thin = false,
}: {
  shape: [number, number][];
  thin?: boolean;
}) {
  const points = shape.map(([x, y]) => `${x * 100},${y * 100}`).join(' ');
  const [startX, startY] = shape[0];
  return (
    <Svg width="100%" height="100%" viewBox="0 0 100 100">
      {thin ? null : (
        <Polyline
          points={points}
          fill="none"
          stroke={palette.white}
          strokeOpacity={0.18}
          strokeWidth={9}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      <Polyline
        points={points}
        fill="none"
        stroke={palette.white}
        strokeWidth={thin ? 1.6 : 3}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Circle
        cx={startX * 100}
        cy={startY * 100}
        r={thin ? 3 : 3.5}
        fill={palette.white}
      />
    </Svg>
  );
}

// 3.1c card colors (runway-course-handoff CourseGrid): blue grey at the top, black from two thirds down.
const cardColors = [
  '#E2EAEE',
  '#C4D4DC',
  '#A4BDC9',
  '#8DACBA',
  '#7DA0B2',
  '#5D8194',
  '#3A5A6C',
  '#182E3D',
  '#091019',
  '#060606',
  '#060606',
];
const cardStops = [0, 0.1, 0.18, 0.25, 0.32, 0.4, 0.47, 0.54, 0.61, 0.68, 1];

// Android breaks Korean between any two letters, so a title too long for one line (about 8 letters on the
// 175 card) is split at the space nearest its middle, as in the mockup's APEC / 나루공원 루프.
export function splitTitle(title: string) {
  if (title.length <= 8) {
    return title;
  }
  const middle = title.length / 2;
  let best = -1;
  for (let at = title.indexOf(' '); at >= 0; at = title.indexOf(' ', at + 1)) {
    if (best < 0 || Math.abs(at - middle) < Math.abs(best - middle)) {
      best = at;
    }
  }
  return best < 0 ? title : `${title.slice(0, best)}\n${title.slice(best + 1)}`;
}

// One saved course: its small outline, the title, distance and time, and 이 코스로 달리기. The whole card
// opens the course run; the mockup has no unsave control, so a small glass bookmark keeps that action.
function SavedCard({
  course,
  height,
  onOpen,
  onUnsave,
}: {
  course: SavedCourse;
  height: number;
  onOpen: () => void;
  onUnsave: () => void;
}) {
  const title = course.myAlias ?? course.name;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${formatKm(course.distanceM, 1)}km ${
        course.expectedMinutes
      }분`}
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        { height },
        pressed && styles.pressed,
      ]}
    >
      <MistFill
        id={`saved${course.id}`}
        colors={cardColors}
        offsets={cardStops}
      />
      <View style={styles.glyph}>
        <CourseGlyph shape={course.shape} thin />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 저장 해제`}
        hitSlop={8}
        onPress={onUnsave}
        style={styles.bookmark}
      >
        <Icon name="bookmark" color="#111111" size={13} solid />
      </Pressable>
      <View style={styles.text}>
        <AppText style={styles.cardTitle} numberOfLines={2}>
          {splitTitle(title)}
        </AppText>
        <AppText style={styles.meta}>
          {`${formatKm(course.distanceM, 1)} km · ${course.expectedMinutes}분`}
        </AppText>
      </View>
      <View style={styles.run}>
        <AppText style={styles.runText}>이 코스로 달리기</AppText>
      </View>
    </Pressable>
  );
}

// 3.1c 저장한 코스: my bookmarked courses, titled with my own nickname. runway-course-handoff: the glass
// tabs in the same place as 3.1, then two columns of three cards that fill the screen.
export function SavedCoursesScreen() {
  const navigation = useNavigation();
  const { courses } = useRepositories();
  const toast = useToast();
  const resource = useResource(useCallback(loadSaved, []));
  const [area, setArea] = useState(0);
  // Three rows fit the screen: 15 under the tabs and at the bottom, 10 between.
  const cardHeight = area ? Math.max(200, (area - 15 * 2 - 10 * 2) / 3) : 245;
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
    try {
      await courses.unsave(course.id);
    } catch {
      // The server kept the course, so it goes back on the list.
      setItems(before);
      toast('저장을 해제하지 못했어요. 잠시 후 다시 시도해 주세요');
      return;
    }
    toast('저장을 해제했어요', {
      actionLabel: '되돌리기',
      onAction: async () => {
        await courses.save(course.id);
        setItems(before);
      },
    });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <CourseTabs current="SavedCourses" />
      <ScrollView
        contentContainerStyle={styles.content}
        onLayout={event => setArea(event.nativeEvent.layout.height)}
      >
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
                height={cardHeight}
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
  content: { paddingHorizontal: 15, paddingVertical: 15, gap: spacing.xl },
  pressed: { opacity: 0.85 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  // Two per row (175 wide on a 390 screen), corners of 22.
  card: {
    width: '48.6%',
    borderRadius: 22,
    overflow: 'hidden',
    boxShadow: '0 14px 30px rgba(2,5,14,0.22)',
  },
  glyph: { position: 'absolute', top: 18, left: 36, right: 36, bottom: 112 },
  bookmark: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: 'rgba(255,255,255,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The title and figures sit on the black lower part, 14 above the button.
  text: { position: 'absolute', left: 12, right: 10, bottom: 60, gap: 4 },
  cardTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  meta: {
    fontFamily: fontFamily.medium,
    fontSize: 11.5,
    lineHeight: 15,
    color: 'rgba(255,255,255,0.42)',
  },
  run: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    height: 38,
    borderRadius: 14,
    backgroundColor: '#EEEEEE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  runText: {
    fontFamily: fontFamily.bold,
    fontSize: 13.5,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#111111',
  },
  error: { alignItems: 'center', gap: spacing.md },
});
