import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon, PressableScale } from '../../components';
import { useResource, type CrewListItem, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing } from '../../theme';
import { groupLook, NumText, Raised, SearchField, groupTone } from './look';
import { CrewPhoto, useGroupRunDraft } from './parts';

// 6.1 crew card (runway-group-screen-designs 01, S15P31E105-594 담당자 시안): a dark navy card with 모집 중 (mint) or
// 정원 마감 (red pink) on the left, the name and the member count beside it, and a chevron. The area and the intro
// (both on 6.2) stay off the row (담당자 요청, S15P31E105-414). A full crew stays listed after the open ones (M01).
function CrewCard({ crew }: { crew: CrewListItem }) {
  const navigation = useNavigation();
  const full = crew.memberCount >= crew.capacity;
  const count = `${crew.memberCount}/${crew.capacity}명`;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${crew.name}, ${
        full ? '정원 마감' : '모집 중'
      } ${count}`}
      onPress={() => navigation.navigate('CrewDetail', { crewId: crew.id })}
    >
      <Raised tone="night" style={styles.crew}>
        {/* The crew photo when it has one (S15P31E105-636). */}
        <CrewPhoto photo={crew.imageUrl} size={40} />
        <View
          style={[styles.status, full ? styles.statusFull : styles.statusOpen]}
        >
          <AppText style={full ? styles.statusTextFull : styles.statusText}>
            {full ? '정원 마감' : '모집 중'}
          </AppText>
        </View>
        <View style={styles.flex}>
          <AppText style={styles.crewName} numberOfLines={1}>
            {crew.name}
          </AppText>
          <View style={styles.countRow}>
            <Icon name="users" color={groupTone.sub} size={14} />
            <NumText style={styles.countText} text={count} />
          </View>
        </View>
        {/* The whole card opens 6.2, so the chevron is only a sign, not a second button for screen readers. */}
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon name="forward" color={groupTone.text} size={20} />
        </View>
      </Raised>
    </PressableScale>
  );
}

// 원하는 크루가 없나요? (6.1-CreateCrewPrompt): two lines on the mist and 크루 만들기 in white. On top of the list,
// under the search when it is open, with a line under it so it reads apart from the crews (S15P31E105-703).
function CreateBox() {
  const navigation = useNavigation();
  return (
    <View style={styles.createBox}>
      <View style={styles.flex}>
        <AppText style={styles.createTitle}>원하는 크루가 없나요?</AppText>
        <AppText style={styles.createSub} numberOfLines={1}>
          직접 만들고 함께 달릴 멤버를 모아 보세요
        </AppText>
      </View>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="크루 만들기"
        onPress={() => navigateTo(navigation, 'CrewCreate')}
        style={styles.createButton}
      >
        <AppText style={styles.createButtonText}>크루 만들기</AppText>
      </PressableScale>
    </View>
  );
}

const searchCrews = (
  repositories: Repositories,
  query: string,
  _version: number,
) => repositories.crews.search({ query, nearby: false });

// 6.1 크루 모집: search by name or area over every crew. The 내 근처 switch is gone: M01 has no location
// filter, so it changed nothing on the server (담당자 결정, S15P31E105-414).
// One page of the group tab pager (GroupTabScreen).
export function CrewRecruitPage({
  searching,
  onCloseSearch,
}: {
  // Opened by the round search button beside the tabs (GroupTabScreen).
  searching: boolean;
  onCloseSearch: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  // Closing the search clears it.
  const closeSearch = () => {
    onCloseSearch();
    setQuery('');
  };
  // version goes up when a crew is made, joined, left or dissolved, so a new crew shows and a dissolved one
  // drops out without leaving the tab (S15P31E105-774).
  const { version } = useGroupRunDraft();
  const found = useResource(
    useCallback(
      (repositories: Repositories) => searchCrews(repositories, query, version),
      [query, version],
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
              insets.bottom +
              size.tabBar +
              size.tabBarInset * 2 +
              spacing.xxxl * 2,
          },
        ]}
      >
        {searching ? (
          <SearchField
            label="크루 검색"
            value={query}
            onChangeText={setQuery}
            onClose={closeSearch}
          />
        ) : null}
        <CreateBox />
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
          <AppText style={[styles.sub, styles.onMist, styles.none]}>
            찾는 크루가 없어요
          </AppText>
        ) : (
          <View style={styles.list}>
            {list.map(crew => (
              <CrewCard key={crew.id} crew={crew} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: spacing.md,
    gap: spacing.xl,
  },
  loading: { marginTop: spacing.xxxl },
  none: { textAlign: 'center', paddingVertical: spacing.xxxl },
  sub: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 19,
    color: groupTone.sub,
  },
  // Text straight on the mist.
  onMist: { color: groupTone.sub },
  list: { gap: 10, marginTop: spacing.sm },
  crew: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 18,
  },
  status: {
    height: 26,
    paddingHorizontal: 10,
    minWidth: 68,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // 모집 중 in mint as the 시안, 정원 마감 a quiet chip.
  statusOpen: { backgroundColor: groupLook.mint },
  statusFull: { backgroundColor: groupTone.quiet },
  statusText: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onMint,
  },
  statusTextFull: {
    fontFamily: fontFamily.bold,
    fontSize: 12,
    lineHeight: 16,
    color: groupTone.sub,
  },
  crewName: {
    fontFamily: fontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: groupTone.text,
  },
  countRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  countText: {
    fontFamily: fontFamily.regular,
    fontSize: 13.5,
    lineHeight: 18,
    color: groupTone.sub,
  },
  createBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingBottom: spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: groupTone.line,
  },
  createTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: groupTone.text,
  },
  createSub: {
    marginTop: 4,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupTone.sub,
  },
  createButton: {
    height: 42,
    paddingHorizontal: 18,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: groupTone.button,
  },
  createButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupTone.onButton,
  },
});
