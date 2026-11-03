import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Card, EmptyState, Icon } from '../../components';
import { useResource, type CrewListItem, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import {
  k1,
  palette,
  radius,
  size,
  spacing,
  ThemeProvider,
  typography,
  useTheme,
} from '../../theme';

// Member dots stand in for faces on the 6.1 cards; there are no profile photos.
const dotTones = [k1.top, k1.mid, k1.deep, k1.light];

function MemberDots({ count }: { count: number }) {
  return (
    <View style={styles.dots}>
      {dotTones.slice(0, Math.min(count, dotTones.length)).map(tone => (
        <View key={tone} style={[styles.dot, { backgroundColor: tone }]} />
      ))}
    </View>
  );
}

// 6.1 card: 모집 중 or 정원 마감 with the count, the intro, members and the area.
// A full crew stays listed but faded, after the open ones (M01).
function CrewCard({ crew }: { crew: CrewListItem }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const full = crew.memberCount >= crew.capacity;
  const count = `${crew.memberCount}/${crew.capacity}명`;
  return (
    <Card
      variant="deep"
      accessibilityLabel={`${crew.name}, ${
        full ? '정원 마감' : '모집 중'
      } ${count}`}
      onPress={() => navigation.navigate('CrewDetail', { crewId: crew.id })}
      style={[styles.card, full && styles.full]}
    >
      <View style={[styles.status, full && styles.statusFull]}>
        <AppText
          variant="captionStrong"
          style={{ color: full ? colors.textSecondary : palette.ink }}
        >
          {`${full ? '정원 마감' : '모집 중'} · ${count}`}
        </AppText>
      </View>
      <View style={styles.titleBlock}>
        <AppText variant="title" numberOfLines={1}>
          {crew.name}
        </AppText>
        {crew.description ? (
          <AppText variant="body" tone="textSecondary" numberOfLines={1}>
            {crew.description}
          </AppText>
        ) : null}
      </View>
      <View style={styles.rowBetween}>
        <View style={styles.members}>
          <MemberDots count={crew.memberCount} />
          <AppText variant="body" tone="textSecondary">
            {`멤버 ${crew.memberCount}`}
          </AppText>
        </View>
        <View style={styles.area}>
          <Icon name="mapPin" color={colors.text} size={16} />
          <AppText variant="bodyStrong">{crew.area}</AppText>
        </View>
      </View>
    </Card>
  );
}

// 원하는 크루가 없나요? A dark see-through box, so it reads on both the light and the black part.
function CreateBox() {
  const navigation = useNavigation();
  return (
    <ThemeProvider tone="dark">
      <View style={styles.createBox}>
        <View style={styles.flex}>
          <AppText variant="heading">원하는 크루가 없나요?</AppText>
          <AppText variant="caption" tone="textSecondary">
            직접 만들고 함께 달릴 멤버를 모아 보세요
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="크루 만들기"
          onPress={() => navigateTo(navigation, 'CrewCreate')}
          style={({ pressed }) => [
            styles.createButton,
            pressed && styles.pressed,
          ]}
        >
          <AppText variant="bodyStrong" style={{ color: palette.ink }}>
            크루 만들기
          </AppText>
        </Pressable>
      </View>
    </ThemeProvider>
  );
}

// 6.1 크루 모집: search by name or area, 내 근처 (3km) on by default.
// One page of the group tab pager (GroupTabScreen).
export function CrewRecruitPage() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [nearby, setNearby] = useState(true);
  const found = useResource(
    useCallback(
      (repositories: Repositories) =>
        repositories.crews.search({ query, nearby }),
      [query, nearby],
    ),
  );
  // While the next search loads, the last list stays so typing does not flash a spinner.
  const [last, setLast] = useState<CrewListItem[] | null>(null);
  const ready = found.status === 'ready' ? found.data : null;
  useEffect(() => {
    if (ready) {
      setLast(ready);
    }
  }, [ready]);
  const list = ready ?? last;

  return (
    <View style={styles.root}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom:
              insets.bottom + size.tabBar + size.tabBarInset * 2 + spacing.xl,
          },
        ]}
      >
        <View
          style={[
            styles.search,
            {
              backgroundColor: colors.inputBackground,
              borderColor: colors.inputBorder,
            },
          ]}
        >
          <Icon name="search" color={colors.textTertiary} size={18} />
          <TextInput
            accessibilityLabel="크루 검색"
            placeholder="크루 이름이나 지역으로 검색"
            placeholderTextColor={colors.textTertiary}
            selectionColor={colors.accent}
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            style={[styles.searchInput, { color: colors.text }]}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="내 근처"
          accessibilityState={{ selected: nearby }}
          onPress={() => setNearby(value => !value)}
          style={[
            styles.chip,
            nearby
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { borderColor: colors.borderStrong },
          ]}
        >
          <Icon
            name="mapPin"
            color={nearby ? colors.onAccent : colors.text}
            size={16}
          />
          <AppText
            variant="bodyStrong"
            style={{ color: nearby ? colors.onAccent : colors.text }}
          >
            내 근처
          </AppText>
        </Pressable>
        {found.status === 'error' ? (
          <EmptyState
            icon="alert"
            title="크루를 불러오지 못했어요"
            actionLabel="다시 시도"
            onAction={found.reload}
          />
        ) : !list ? (
          <ActivityIndicator style={styles.loading} />
        ) : list.length === 0 ? (
          <AppText variant="body" tone="textSecondary" style={styles.none}>
            {nearby
              ? '내 근처에서 찾지 못했어요. 내 근처를 끄고 다시 찾아보세요.'
              : '찾는 크루가 없어요.'}
          </AppText>
        ) : (
          list.map(crew => <CrewCard key={crew.id} crew={crew} />)
        )}
        <CreateBox />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: spacing.screen, gap: spacing.xl },
  loading: { marginTop: spacing.xxxl },
  none: { textAlign: 'center', paddingVertical: spacing.xxxl },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    height: size.input,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  // No lineHeight: on Android it clips the top of the placeholder in a single-line input.
  searchInput: {
    flex: 1,
    height: size.input,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    height: size.buttonSmall,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  card: { gap: spacing.lg },
  full: { opacity: 0.55 },
  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: k1.ice,
  },
  statusFull: { backgroundColor: 'rgba(255,255,255,0.12)' },
  titleBlock: { gap: spacing.xxs },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  members: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  // Each dot tucks 8 under the next; the row gives the last one's 8 back so 멤버 keeps its gap.
  dots: { flexDirection: 'row', marginRight: spacing.md },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: k1.deep,
    marginRight: -spacing.md,
  },
  area: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 32,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  createBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    padding: spacing.xxl,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(2,5,14,0.45)',
  },
  createButton: {
    height: size.buttonSmall,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.pill,
    justifyContent: 'center',
    backgroundColor: k1.ice,
  },
  pressed: { opacity: 0.8 },
});
