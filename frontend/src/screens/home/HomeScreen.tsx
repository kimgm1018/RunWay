import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  AppText,
  Backdrop,
  Button,
  Icon,
  IconButton,
  Logo,
  Segmented,
} from '../../components';
import {
  useRepositories,
  useResource,
  type RecordSort,
  type Repositories,
} from '../../data';
import {
  formatDotDate,
  formatDuration,
  formatKm,
  formatMonth,
  formatPace,
} from '../../format';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, radius, size, spacing, useTheme } from '../../theme';
import { CardTitle, GlassCard, ListRow, PillLink } from './parts';
import { HomeWidgets } from './widgets';

const weekdays = ['월', '화', '수', '목', '금', '토', '일'];

const sorts: { value: RecordSort; label: string }[] = [
  { value: 'recent', label: '최신순' },
  { value: 'distance', label: '거리순' },
  { value: 'pace', label: '페이스순' },
];

const loadHome = (repositories: Repositories) =>
  Promise.all([
    repositories.profile.getMe(),
    repositories.home.getTodayCondition(),
    repositories.home.getMonthlySummary(),
    repositories.courses.getSaved(),
    repositories.notifications.list(),
  ]);

function Avatar({
  nickname,
  photo,
  onPress,
}: {
  nickname: string;
  photo: string | null;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="내 프로필"
      onPress={onPress}
      style={[
        styles.avatar,
        {
          borderColor: colors.borderStrong,
          backgroundColor: colors.surfaceMuted,
        },
      ]}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} />
      ) : (
        <AppText variant="bodyStrong">{nickname.slice(0, 1)}</AppText>
      )}
    </Pressable>
  );
}

function RecordsCard() {
  const navigation = useNavigation();
  const [sort, setSort] = useState<RecordSort>('recent');
  const records = useResource(
    useCallback(
      (repositories: Repositories) => repositories.records.getRecent(sort, 4),
      [sort],
    ),
  );
  return (
    <GlassCard>
      <CardTitle
        title="과거 러닝 기록"
        right={
          <Segmented compact options={sorts} value={sort} onChange={setSort} />
        }
      />
      {records.status === 'ready' ? (
        <View>
          {records.data.map(record => (
            <ListRow
              key={record.id}
              title={record.title}
              detail={`${formatDotDate(record.startedAt)} · ${formatKm(
                record.distanceM,
              )}km · ${formatDuration(record.durationSec)}`}
              value={formatPace(record.averagePaceSecPerKm)}
              shape={record.shape}
              onPress={() =>
                navigation.navigate('RecordDetail', { recordId: record.id })
              }
            />
          ))}
        </View>
      ) : (
        <ActivityIndicator />
      )}
      <PillLink
        title="전체 기록 보기"
        onPress={() => navigateTo(navigation, 'Records')}
      />
    </GlassCard>
  );
}

// 2.1 홈: the widget board of 대표화면시안 on the K1 background, then the prototype's analysis, records and saved courses.
export function HomeScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const repositories = useRepositories();
  const home = useResource(useCallback(loadHome, []));
  const insets = useSafeAreaInsets();
  const [me, today, summary, courses, notifications] =
    home.status === 'ready' ? home.data : [];
  const photo = me?.profileImageUrl ?? null;
  const unread = notifications?.some(item => !item.read) ?? false;
  const peak = summary ? Math.max(...summary.weekdayRatios) : 0;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop />
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + size.header },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <AppText style={styles.greeting}>
          {me ? `${me.nickname}님,\n` : ''}
          <AppText tone="textTertiary" style={styles.greetingText}>
            오늘 달리기 좋은 날이에요
          </AppText>
        </AppText>
        {home.status === 'loading' ? (
          <ActivityIndicator color={colors.accent} />
        ) : home.status === 'error' ? (
          <GlassCard>
            <AppText tone="danger">홈 정보를 불러오지 못했어요</AppText>
            <Button
              title="다시 시도"
              variant="secondary"
              size="small"
              onPress={home.reload}
            />
          </GlassCard>
        ) : null}
        {today ? <HomeWidgets today={today} /> : null}
        {summary ? (
          <GlassCard>
            <CardTitle title="러닝 분석" note={formatMonth(summary.month)} />
            <View style={styles.stats}>
              {[
                {
                  value: String(summary.runCount),
                  unit: '회',
                  label: '러닝',
                },
                {
                  value: formatKm(summary.totalDistanceM, 1),
                  unit: 'km',
                  label: '누적 거리',
                },
                {
                  value:
                    summary.averagePaceSecPerKm === null
                      ? '– –'
                      : formatPace(summary.averagePaceSecPerKm),
                  unit: '',
                  label: '평균 페이스',
                },
              ].map(stat => (
                <View key={stat.label} style={styles.stat}>
                  <AppText variant="metricLarge">
                    {stat.value}
                    <AppText variant="caption" tone="textTertiary">
                      {stat.unit}
                    </AppText>
                  </AppText>
                  <AppText style={styles.tiny} tone="textTertiary">
                    {stat.label}
                  </AppText>
                </View>
              ))}
            </View>
            <View style={styles.bars} accessibilityLabel="요일별 러닝 거리">
              {summary.weekdayRatios.map((ratio, index) => (
                <View key={weekdays[index]} style={styles.barColumn}>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.bar,
                        {
                          height: `${Math.max(ratio, 0.04) * 100}%`,
                          backgroundColor:
                            ratio === peak
                              ? colors.accent
                              : ratio > 0.05
                              ? colors.accentSoft
                              : colors.border,
                        },
                      ]}
                    />
                  </View>
                  <AppText style={styles.weekday} tone="textTertiary">
                    {weekdays[index]}
                  </AppText>
                </View>
              ))}
            </View>
            {summary.paceImprovementSec ? (
              <AppText variant="caption" tone="textSecondary">
                지난달보다 평균 페이스{' '}
                <AppText variant="captionStrong" tone="accentText">
                  {summary.paceImprovementSec > 0
                    ? `${summary.paceImprovementSec}초 빨라졌어요`
                    : `${-summary.paceImprovementSec}초 느려졌어요`}
                </AppText>
              </AppText>
            ) : null}
            <PillLink
              title="분석 자세히 보기"
              onPress={() => navigateTo(navigation, 'Analysis')}
            />
          </GlassCard>
        ) : null}
        {home.status === 'ready' ? <RecordsCard /> : null}
        {courses ? (
          <GlassCard>
            <CardTitle title="저장한 코스" note={`${courses.length}개`} />
            <View>
              {courses.slice(0, 3).map(course => (
                <ListRow
                  key={course.id}
                  title={course.myAlias ?? course.name}
                  detail={`${formatKm(course.distanceM, 1)}km · ${
                    course.expectedMinutes
                  }분`}
                  shape={course.shape}
                  onPress={async () => {
                    await repositories.courses.choose(course.id);
                    navigateTo(navigation, 'CourseRun');
                  }}
                  trailing={
                    <Icon name="bookmark" color={colors.accentText} size={16} />
                  }
                />
              ))}
            </View>
            <PillLink
              title="저장한 코스 전체 보기"
              onPress={() => navigateTo(navigation, 'SavedCourses')}
            />
          </GlassCard>
        ) : null}
      </ScrollView>
      {/* The header floats over the cards as they scroll up, as in the prototype. */}
      <SafeAreaView
        edges={['top']}
        style={styles.headerLayer}
        pointerEvents="box-none"
      >
        <View style={styles.header}>
          <View style={styles.logo}>
            <Logo width={100} />
          </View>
          <IconButton
            icon="bell"
            accessibilityLabel="알림"
            badge={unread}
            onPress={() => navigateTo(navigation, 'Notifications')}
          />
          <IconButton
            icon="settings"
            accessibilityLabel="설정"
            onPress={() => navigateTo(navigation, 'Settings')}
          />
          <Avatar
            nickname={me?.nickname ?? ''}
            photo={photo}
            onPress={() => navigateTo(navigation, 'MyProfile')}
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerLayer: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  logo: { flex: 1 },
  avatar: {
    width: size.iconButton,
    height: size.iconButton,
    borderRadius: size.iconButton / 2,
    borderWidth: 1.5,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.screen,
    paddingBottom: size.tabBar + size.tabBarInset * 2 + spacing.xxxl,
    gap: spacing.xl,
  },
  // 25 Medium with the second line dimmed, as on the widget home draft.
  greetingText: {
    fontFamily: fontFamily.medium,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.7,
  },
  greeting: {
    fontFamily: fontFamily.medium,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.7,
    paddingTop: spacing.xl,
  },
  stats: { flexDirection: 'row', gap: spacing.xs },
  stat: { flex: 1, gap: spacing.xs },
  tiny: { fontSize: 10, lineHeight: 14 },
  bars: { flexDirection: 'row', gap: spacing.sm },
  barColumn: { flex: 1, alignItems: 'center', gap: spacing.xs },
  barTrack: { width: '100%', height: 64, justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: radius.xs },
  weekday: { fontSize: 9, lineHeight: 12 },
});
