import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, EmptyState, Icon, PressableScale } from '../../components';
import { useResource, type CrewListItem, type Repositories } from '../../data';
import { navigateTo } from '../../navigation/navigateTo';
import { fontFamily, size, spacing } from '../../theme';
import { crewCard, groupLook, Raised, SearchField } from './look';

// 6.1 row on the crew card 6.0 uses too (look.tsx crewCard): 모집 중 or 정원 마감, then the name with the
// count. The area and the intro (both on 6.2), the member dots and '멤버 N' (the count again) are left
// out to keep the row short (담당자 요청, S15P31E105-414). A full crew stays listed after the open ones
// (M01), as readable as they are; 정원 마감 tells it apart.
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
      style={[crewCard.card, styles.crew]}
    >
      <View style={styles.flex}>
        {/* 모집 중 alone on top, the count right after the name (담당자 요청). Plain regular text, no
            pill. */}
        <AppText style={[crewCard.small, styles.statusText]}>
          {full ? '정원 마감' : '모집 중'}
        </AppText>
        <View style={[crewCard.lineGap, styles.nameLine]}>
          <AppText style={[crewCard.name, styles.crewName]} numberOfLines={1}>
            {crew.name}
          </AppText>
          <AppText style={styles.countText}>{count}</AppText>
        </View>
      </View>
      {/* A round arrow, not a pill, so the card reads as one to open (담당자 요청). The whole card
          opens 6.2, so the arrow is only a sign and not a second button for screen readers. */}
      <View
        style={crewCard.round}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon name="arrowRight" color={groupLook.onDark} size={16} />
      </View>
    </PressableScale>
  );
}

// 원하는 크루가 없나요? (6.1-CreateCrewPrompt): two lines and a small raised white button, no box.
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
      >
        <Raised tone="navy" style={styles.createButton}>
          <AppText style={styles.createButtonText}>크루 만들기</AppText>
        </Raised>
      </PressableScale>
    </View>
  );
}

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
  const found = useResource(
    useCallback(
      (repositories: Repositories) =>
        repositories.crews.search({ query, nearby: false }),
      [query],
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
            찾는 크루가 없어요.
          </AppText>
        ) : (
          <View style={styles.list}>
            {list.map(crew => (
              <CrewCard key={crew.id} crew={crew} />
            ))}
          </View>
        )}
        <CreateBox />
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
    color: groupLook.onDarkSub,
  },
  // Text straight on the mist rather than in a navy crew card (S15P31E105-483).
  onMist: { color: groupLook.onLightSub },
  list: { gap: 12, marginTop: spacing.md },
  // 6.1-CrewCard on a navy card so each crew reads as something to tap (담당자 요청, S15P31E105-483).
  crew: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // Regular weight, not bold (담당자 요청).
  countText: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
    color: groupLook.onDarkSub,
  },
  statusText: { color: groupLook.onDark },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  crewName: { flexShrink: 1 },
  createBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    marginTop: spacing.xxxl,
  },
  createTitle: {
    fontFamily: fontFamily.bold,
    fontSize: 16.5,
    lineHeight: 21,
    letterSpacing: -0.3,
    color: groupLook.onLight,
  },
  // A little more room under 원하는 크루가 없나요? (담당자 요청).
  createSub: {
    marginTop: 6,
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 17,
    color: groupLook.onLightSub,
  },
  createButton: {
    width: 100,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButtonText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    color: groupLook.onDark,
  },
});
