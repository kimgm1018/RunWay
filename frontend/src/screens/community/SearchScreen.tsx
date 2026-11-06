import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, Icon, type IconName } from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  errorCode,
  useRepositories,
  type SearchPage,
  type SearchType,
} from '../../data';
import { fontFamily } from '../../theme';

// 7.5 커뮤니티 검색 (runway-search, CMT13): runners and crews by name, from 7.1's 검색 button.
// It searches 0.3 s after typing stops; under two letters it says so without asking the server.
// 뒤로 and the filter are 44 like every round button of the app (담당자 결정), not the mockup's 38.

const look = {
  ink: '#02050E',
  sub: '#56646C',
  bandText: '#3A5A6C',
  band: 'rgba(24,46,61,0.08)',
  // The tab bar's selected cell: avatars and crew marks.
  mark: '#0F1011',
  picked: 'rgba(24,46,61,0.06)',
} as const;

const minLength = 2;
const waitMs = 300;
// 전체 shows four of each; 러너 · 크루 show the whole list and read on with the cursor.
const previewCount = 4;

const filters: { type: SearchType; label: string; placeholder: string }[] = [
  { type: 'ALL', label: '전체', placeholder: '러너·크루 검색' },
  { type: 'RUNNER', label: '러너', placeholder: '러너 닉네임' },
  { type: 'CREW', label: '크루', placeholder: '크루 이름' },
];

type Row =
  | { kind: 'band'; key: string; label: string }
  | { kind: 'runner'; key: string; userId: string; name: string }
  | { kind: 'crew'; key: string; crewId: string; name: string }
  | { kind: 'gap'; key: string };

type Found = {
  runners: SearchPage['runners'];
  crews: SearchPage['crews'];
  cursor: string | null;
};

type Status = 'idle' | 'short' | 'loading' | 'ready' | 'error';

function rowsOf(found: Found, type: SearchType): Row[] {
  const limit = type === 'ALL' ? previewCount : Infinity;
  const runners = found.runners.slice(0, limit);
  const crews = found.crews.slice(0, limit);
  const rows: Row[] = [];
  if (runners.length > 0) {
    rows.push({ kind: 'band', key: 'band-runner', label: '러너' });
    runners.forEach(runner =>
      rows.push({
        kind: 'runner',
        key: `runner-${runner.userId}`,
        userId: runner.userId,
        name: runner.nickname,
      }),
    );
  }
  if (crews.length > 0) {
    if (rows.length > 0) rows.push({ kind: 'gap', key: 'gap' });
    rows.push({ kind: 'band', key: 'band-crew', label: '크루' });
    crews.forEach(crew =>
      rows.push({
        kind: 'crew',
        key: `crew-${crew.crewId}`,
        crewId: crew.crewId,
        name: crew.name,
      }),
    );
  }
  return rows;
}

// The name with the part that matches the query in bold, case left as typed in the name.
function Highlighted({ name, query }: { name: string; query: string }) {
  const at = name.toLowerCase().indexOf(query.toLowerCase());
  if (!query || at < 0) {
    return <AppText style={styles.name}>{name}</AppText>;
  }
  return (
    <AppText style={styles.name} numberOfLines={1}>
      {name.slice(0, at)}
      <AppText style={[styles.name, styles.match]}>
        {name.slice(at, at + query.length)}
      </AppText>
      {name.slice(at + query.length)}
    </AppText>
  );
}

function StateMessage({
  icon,
  title,
  body,
  onRetry,
}: {
  icon: IconName;
  title: string;
  body: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      <Icon name={icon} color={look.sub} size={44} strokeWidth={1.8} />
      <AppText style={styles.stateTitle} accessibilityRole="header">
        {title}
      </AppText>
      <AppText style={styles.stateBody}>{body}</AppText>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
          onPress={onRetry}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Icon name="refresh" color="#FFFFFF" size={18} strokeWidth={2} />
          <AppText style={styles.retryText}>다시 시도</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function SearchScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { search } = useRepositories();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('ALL');
  const [menuOpen, setMenuOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [found, setFound] = useState<Found>({
    runners: [],
    crews: [],
    cursor: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  // Only the newest request may change the screen; older answers are dropped.
  const latest = useRef(0);
  const words = query.trim();
  const filter = filters.find(item => item.type === type) ?? filters[0];

  const runSearch = useCallback(
    async (text: string, kind: SearchType) => {
      const id = (latest.current += 1);
      setStatus('loading');
      try {
        const page = await search.find({ query: text, type: kind });
        if (id !== latest.current) return;
        setFound(page);
        setStatus('ready');
      } catch (error) {
        if (id !== latest.current) return;
        setStatus(errorCode(error) === 'QUERY_TOO_SHORT' ? 'short' : 'error');
      }
    },
    [search],
  );

  useEffect(() => {
    if (words.length === 0) {
      latest.current += 1;
      setStatus('idle');
      return;
    }
    if (words.length < minLength) {
      latest.current += 1;
      setStatus('short');
      return;
    }
    const timer = setTimeout(() => runSearch(words, type), waitMs);
    return () => clearTimeout(timer);
  }, [words, type, runSearch]);

  // 러너 · 크루 read on from the cursor at the end of the list; 전체 stays at four of each.
  const loadMore = async () => {
    if (type === 'ALL' || !found.cursor || loadingMore || status !== 'ready') {
      return;
    }
    const id = latest.current;
    setLoadingMore(true);
    try {
      const page = await search.find({
        query: words,
        type,
        cursor: found.cursor,
      });
      if (id !== latest.current) return;
      setFound(before => ({
        runners: [...before.runners, ...page.runners],
        crews: [...before.crews, ...page.crews],
        cursor: page.cursor,
      }));
    } catch {
      // The next end-of-list scroll tries again.
    } finally {
      setLoadingMore(false);
    }
  };

  const rows = status === 'ready' ? rowsOf(found, type) : [];

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'gap') return <View style={styles.gap} />;
    if (item.kind === 'band') {
      return (
        <View style={styles.band}>
          <AppText style={styles.bandText} accessibilityRole="header">
            {item.label}
          </AppText>
        </View>
      );
    }
    const runner = item.kind === 'runner';
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${item.name} ${
          runner ? '러너 프로필' : '크루 상세'
        }`}
        onPress={() =>
          item.kind === 'runner'
            ? navigation.navigate('RunnerProfile', { userId: item.userId })
            : navigation.navigate('CrewDetail', { crewId: item.crewId })
        }
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      >
        <View style={[styles.mark, runner ? styles.avatar : styles.crewMark]}>
          {runner ? (
            <AppText style={styles.initial}>
              {item.name.slice(0, 1).toUpperCase()}
            </AppText>
          ) : (
            <Icon name="users" color="#FFFFFF" size={22} strokeWidth={1.9} />
          )}
        </View>
        <View style={styles.nameBox}>
          <Highlighted name={item.name} query={words} />
        </View>
        <Icon name="forward" color={look.sub} size={18} strokeWidth={1.8} />
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.field} accessibilityRole="search">
          <Icon name="search" color={look.bandText} size={20} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={filter.placeholder}
            placeholderTextColor="rgba(2,5,14,0.42)"
            accessibilityLabel={`${filter.placeholder} 검색`}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.input}
          />
          {query.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="검색어 지우기"
              onPress={() => setQuery('')}
              hitSlop={6}
              style={styles.clear}
            >
              <View style={styles.clearDot}>
                <Icon
                  name="close"
                  color="#FFFFFF"
                  size={11}
                  strokeWidth={2.6}
                />
              </View>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`검색 대상 ${filter.label}`}
          accessibilityState={{ expanded: menuOpen }}
          onPress={() => setMenuOpen(open => !open)}
          style={({ pressed }) => [styles.filter, pressed && styles.pressed]}
        >
          <AppText style={styles.filterText}>{filter.label}</AppText>
          <View style={menuOpen ? styles.flipped : undefined}>
            <Icon
              name="chevronDown"
              color={look.ink}
              size={16}
              strokeWidth={2.2}
            />
          </View>
        </Pressable>
      </View>

      {status === 'idle' ? (
        <StateMessage
          icon="search"
          title="러너나 크루를 찾아보세요"
          body="닉네임이나 크루 이름으로 검색할 수 있어요"
        />
      ) : status === 'short' ? (
        <StateMessage
          icon="search"
          title="검색어가 너무 짧아요"
          body="두 글자 이상 입력해 주세요"
        />
      ) : status === 'error' ? (
        <StateMessage
          icon="alert"
          title="검색 결과를 불러오지 못했어요"
          body="네트워크 상태를 확인하고 다시 시도해 주세요"
          onRetry={() => runSearch(words, type)}
        />
      ) : status === 'loading' ? (
        <ActivityIndicator style={styles.loading} color={look.bandText} />
      ) : rows.length === 0 ? (
        <StateMessage
          icon="search"
          title={`‘${words}’ 결과가 없어요`}
          body="러너 닉네임과 크루 이름만 검색돼요"
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={item => item.key}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.more}>
                <ActivityIndicator size="small" color={look.bandText} />
                <AppText style={styles.moreText}>더 불러오는 중</AppText>
              </View>
            ) : null
          }
        />
      )}

      {menuOpen ? (
        <>
          <Pressable
            accessibilityLabel="필터 닫기"
            onPress={() => setMenuOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityRole="menu"
            style={[styles.menu, { top: insets.top + 6 + 44 + 10 }]}
          >
            {filters.map(item => {
              const picked = item.type === type;
              return (
                <Pressable
                  key={item.type}
                  accessibilityRole="menuitem"
                  accessibilityLabel={item.label}
                  accessibilityState={{ selected: picked }}
                  onPress={() => {
                    setType(item.type);
                    setMenuOpen(false);
                  }}
                  style={[styles.option, picked && styles.optionPicked]}
                >
                  <AppText
                    style={[
                      styles.optionText,
                      picked && styles.optionTextPicked,
                    ]}
                  >
                    {item.label}
                  </AppText>
                  {picked ? (
                    <Icon
                      name="check"
                      color={look.ink}
                      size={18}
                      strokeWidth={2.2}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );
}

const raised = {
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.6)',
  backgroundColor: 'rgba(255,255,255,0.5)',
  boxShadow:
    '0 10px 30px rgba(9,17,26,0.08), inset 0 1px 0 rgba(255,255,255,0.7)',
} as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFB' },
  pressed: { opacity: 0.6 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  field: {
    ...raised,
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    fontFamily: fontFamily.medium,
    fontSize: 15.5,
    color: look.ink,
  },
  clear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(24,46,61,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filter: {
    ...raised,
    height: 44,
    borderRadius: 22,
    paddingLeft: 16,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  filterText: {
    fontFamily: fontFamily.bold,
    fontSize: 14,
    letterSpacing: -0.3,
    color: look.ink,
  },
  flipped: { transform: [{ rotate: '180deg' }] },
  menu: {
    position: 'absolute',
    right: 16,
    width: 176,
    padding: 6,
    gap: 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    // The mockup's 94% white sits on a blur; without one the rows behind show through, so it is solid.
    backgroundColor: '#FCFDFD',
    boxShadow:
      '0 22px 48px rgba(9,17,26,0.18), 0 2px 8px rgba(9,17,26,0.06), inset 0 1px 0 #FFFFFF',
  },
  option: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  optionPicked: { backgroundColor: look.picked },
  optionText: {
    flex: 1,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    letterSpacing: -0.3,
    color: look.ink,
  },
  optionTextPicked: { fontFamily: fontFamily.bold },
  // The 8.1 band: full width, 48 high.
  band: {
    height: 48,
    marginBottom: 4,
    paddingHorizontal: 16,
    justifyContent: 'center',
    backgroundColor: look.band,
  },
  bandText: {
    fontFamily: fontFamily.bold,
    fontSize: 15,
    letterSpacing: -0.2,
    color: look.bandText,
  },
  gap: { height: 12 },
  row: {
    height: 60,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowPressed: { backgroundColor: 'rgba(2,5,14,0.04)' },
  mark: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.mark,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.5)',
  },
  avatar: { borderRadius: 20 },
  crewMark: { borderRadius: 13 },
  initial: { fontFamily: fontFamily.bold, fontSize: 15, color: '#FFFFFF' },
  nameBox: { flex: 1, minWidth: 0 },
  name: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: -0.2,
    color: look.ink,
  },
  match: { fontFamily: fontFamily.black },
  state: {
    alignItems: 'center',
    paddingHorizontal: 32,
    marginTop: '45%',
    gap: 8,
  },
  stateTitle: {
    marginTop: 16,
    fontFamily: fontFamily.bold,
    fontSize: 19,
    letterSpacing: -0.4,
    color: look.ink,
    textAlign: 'center',
  },
  stateBody: {
    fontSize: 14,
    lineHeight: 20,
    color: look.sub,
    textAlign: 'center',
  },
  retry: {
    marginTop: 20,
    height: 48,
    paddingHorizontal: 28,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#02050D',
    boxShadow: '0 10px 24px rgba(2,5,14,0.22)',
  },
  retryText: { fontFamily: fontFamily.bold, fontSize: 16, color: '#FFFFFF' },
  loading: { marginTop: 48 },
  more: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  moreText: { fontSize: 13, fontFamily: fontFamily.medium, color: look.sub },
});
