import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Backdrop, Icon, type IconName } from '../../components';
import { BackButton } from '../../components/BackButton';
import {
  errorCode,
  useRepositories,
  type Post,
  type SearchPage,
  type SearchType,
} from '../../data';
import { formatKm } from '../../format';
import { fontFamily } from '../../theme';
import { feedLook, MapBackdrop, RouteLine } from './FeedPage';
import { Avatar } from './parts';

// 7.5 커뮤니티 탐색 · 검색 (runway-search, CMT13): runners and crews by name, from 7.1's 검색 button.
// It searches 0.3 s after typing stops; under two letters it says so without asking the server.
// S15P31E105-561 (담당자 시안): it opens on 탐색, a two-column grid of shared runs under a white search pill and
// the 전체 · 러너 · 크루 chips; focusing the field shows 추천 runners, and typing searches as before.

const look = {
  ground: '#F2F3F6',
  white: '#FFFFFF',
  ink: '#02050E',
  sub: '#56646C',
  bandText: '#3A5A6C',
  chip: '#E4E6EB',
  // The tab bar's selected cell: avatars and crew marks.
  mark: '#0F1011',
  skeleton: '#E4E6EB',
} as const;

// S15P31E105-795: 탐색 is not the feed again. It shows only the runs that share their course, not mine, and reads
// the feed on from its cursor when the grid ends. A page can hold none of those, so a read goes on up to
// maxPages pages until it has something to add (firstFill on the first read, so the grid fills a screen).
const explorable = (post: Post) => post.courseShared && !post.isMine;
const firstFill = 6;
const maxPages = 5;

type Explore = {
  posts: Post[];
  cursor: string | null;
  status: 'loading' | 'ready' | 'error';
};

function useExplore() {
  const { community } = useRepositories();
  const [state, setState] = useState<Explore>({
    posts: [],
    cursor: null,
    status: 'loading',
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const alive = useRef(true);
  const busy = useRef(false);

  const pull = useCallback(
    async (start: string | undefined, seen: Post[], want: number) => {
      let posts = seen;
      let at = start;
      for (let page = 0; page < maxPages; page += 1) {
        const result = await community.listFeed('ALL', at);
        const have = new Set(posts.map(post => post.id));
        posts = [
          ...posts,
          ...result.items.filter(
            post => explorable(post) && !have.has(post.id),
          ),
        ];
        at = result.nextCursor ?? undefined;
        if (!at || posts.length - seen.length >= want) break;
      }
      return { posts, cursor: at ?? null };
    },
    [community],
  );

  const load = useCallback(async () => {
    busy.current = true;
    setState({ posts: [], cursor: null, status: 'loading' });
    try {
      const next = await pull(undefined, [], firstFill);
      if (alive.current) setState({ ...next, status: 'ready' });
    } catch {
      if (alive.current) setState({ posts: [], cursor: null, status: 'error' });
    } finally {
      busy.current = false;
    }
  }, [pull]);

  useEffect(() => {
    alive.current = true;
    load();
    return () => {
      alive.current = false;
    };
  }, [load]);

  const more = useCallback(async () => {
    if (busy.current || state.status !== 'ready' || !state.cursor) return;
    busy.current = true;
    setLoadingMore(true);
    try {
      const next = await pull(state.cursor, state.posts, 1);
      if (alive.current) setState({ ...next, status: 'ready' });
    } catch {
      // The next end-of-grid scroll tries again.
    } finally {
      busy.current = false;
      if (alive.current) setLoadingMore(false);
    }
  }, [pull, state]);

  return { ...state, loadingMore, reload: load, more };
}

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
  | {
      kind: 'runner';
      key: string;
      userId: string;
      name: string;
      photo: string | null;
    }
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
        photo: runner.profileImageUrl,
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
  // The field has focus: with nothing typed it shows 추천 instead of 탐색.
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInput>(null);
  const explore = useExplore();
  const { width: screenWidth } = useWindowDimensions();
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
  const posts = explore.status === 'ready' ? explore.posts : null;
  // 추천: the runners of the shared runs, each once, not me.
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return (posts ?? [])
      .filter(post => !post.isMine)
      .map(post => post.author)
      .filter(author => {
        if (seen.has(author.userId)) return false;
        seen.add(author.userId);
        return true;
      })
      .slice(0, 8);
  }, [posts]);
  const exploring = words.length === 0 && !focused;
  const suggesting = words.length === 0 && focused;
  // Whole pixels: two cards and the gap fill the row exactly, so the second never wraps under the first.
  const cardWidth = Math.floor((screenWidth - gutter * 2 - gap) / 2);
  const cardHeight = Math.round(cardWidth * 1.6);
  const closeSearch = () => {
    setQuery('');
    input.current?.blur();
    setFocused(false);
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.kind === 'gap') return <View style={styles.gapRow} />;
    if (item.kind === 'band') {
      return (
        <AppText style={styles.section} accessibilityRole="header">
          {item.label}
        </AppText>
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
        style={({ pressed }) => [styles.person, pressed && styles.pressed]}
      >
        {item.kind === 'runner' ? (
          <Avatar
            nickname={item.name.toUpperCase()}
            userId={item.userId}
            photo={item.photo}
            size={48}
          />
        ) : (
          <View style={[styles.mark, styles.crewMark]}>
            <Icon name="users" color="#FFFFFF" size={22} strokeWidth={1.9} />
          </View>
        )}
        <View style={styles.nameBox}>
          <Highlighted name={item.name} query={words} />
          <AppText style={styles.personSub}>{runner ? '러너' : '크루'}</AppText>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />
      {/* 탐색 sits on the app's mist like 홈 (담당자 요청). */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Backdrop tail />
      </View>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <BackButton onPress={() => navigation.goBack()} />
        <AppText style={styles.title} accessibilityRole="header">
          탐색
        </AppText>
      </View>
      <View style={styles.field} accessibilityRole="search">
        <Icon name="search" color={look.sub} size={20} strokeWidth={2} />
        <TextInput
          ref={input}
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={filter.placeholder}
          placeholderTextColor="rgba(2,5,14,0.42)"
          accessibilityLabel={`${filter.placeholder} 검색`}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {query.length > 0 || focused ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="검색어 지우기"
            onPress={closeSearch}
            hitSlop={8}
          >
            <Icon name="close" color={look.sub} size={20} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
          accessibilityRole="tablist"
        >
          {filters.map(item => {
            const picked = item.type === type;
            return (
              <Pressable
                key={item.type}
                accessibilityRole="tab"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: picked }}
                onPress={() => {
                  setType(item.type);
                  // 러너 · 크루 before any typing: go to the field and show 추천 instead of an unchanged grid.
                  if (item.type !== 'ALL' && words.length === 0) {
                    setFocused(true);
                    input.current?.focus();
                  }
                }}
                style={({ pressed }) => [
                  styles.chip,
                  picked && styles.chipPicked,
                  pressed && styles.pressed,
                ]}
              >
                <AppText
                  style={[styles.chipText, picked && styles.chipTextPicked]}
                >
                  {item.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      }

      {exploring ? (
        <ScrollView
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={100}
          onScroll={event => {
            const { contentOffset, contentSize, layoutMeasurement } =
              event.nativeEvent;
            // Near the end of the grid: read the feed on.
            if (
              contentOffset.y + layoutMeasurement.height >=
              contentSize.height - cardHeight
            ) {
              explore.more();
            }
          }}
        >
          {posts
            ? posts.map(post => (
                <ExploreCard
                  key={post.id}
                  post={post}
                  width={cardWidth}
                  height={cardHeight}
                  onPress={() =>
                    navigation.navigate('PostDetail', { postId: post.id })
                  }
                />
              ))
            : explore.status === 'error'
            ? null
            : [0, 1, 2, 3].map(index => (
                <View
                  key={index}
                  style={[
                    styles.card,
                    styles.skeleton,
                    { width: cardWidth, height: cardHeight },
                  ]}
                />
              ))}
          {explore.status === 'error' ? (
            <StateMessage
              icon="alert"
              title="러닝을 불러오지 못했어요"
              body="검색으로 러너나 크루를 찾아보세요"
              onRetry={explore.reload}
            />
          ) : posts && posts.length === 0 ? (
            <StateMessage
              icon="search"
              title="공유된 코스가 아직 없어요"
              body="위 검색창에서 러너나 크루를 찾아보세요"
            />
          ) : null}
          {explore.loadingMore ? (
            <View style={styles.more}>
              <ActivityIndicator size="small" color={look.bandText} />
              <AppText style={styles.moreText}>더 불러오는 중</AppText>
            </View>
          ) : null}
        </ScrollView>
      ) : suggesting ? (
        <ScrollView keyboardShouldPersistTaps="handled">
          {type === 'CREW' ? null : (
            <AppText style={styles.section} accessibilityRole="header">
              추천
            </AppText>
          )}
          {type === 'CREW' ? (
            <StateMessage
              icon="search"
              title="크루 이름을 입력해 보세요"
              body="두 글자 이상 입력하면 크루를 찾아요"
            />
          ) : suggestions.length === 0 ? (
            <StateMessage
              icon="search"
              title="러너나 크루를 찾아보세요"
              body="닉네임이나 크루 이름으로 검색할 수 있어요"
            />
          ) : (
            suggestions.map(author => (
              <Pressable
                key={author.userId}
                accessibilityRole="button"
                accessibilityLabel={`${author.handle} 러너 프로필`}
                onPress={() =>
                  navigation.navigate('RunnerProfile', {
                    userId: author.userId,
                  })
                }
                style={({ pressed }) => [
                  styles.person,
                  pressed && styles.pressed,
                ]}
              >
                <Avatar
                  nickname={author.nickname}
                  userId={author.userId}
                  photo={author.profileImageUrl}
                  size={48}
                />
                <View style={styles.nameBox}>
                  <AppText style={styles.name} numberOfLines={1}>
                    {author.nickname}
                  </AppText>
                  <AppText style={styles.personSub} numberOfLines={1}>
                    {`@${author.handle}`}
                  </AppText>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
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
      ) : status === 'loading' || status === 'idle' ? (
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
    </View>
  );
}

const gutter = 16;
const gap = 10;

// 탐색 card (시안): the run on the dark map with its route, the author at the top and the distance at the foot.
function ExploreCard({
  post,
  width,
  height,
  onPress,
}: {
  post: Post;
  width: number;
  height: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${post.author.handle}의 ${formatKm(
        post.record.distanceM,
      )}km 러닝`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { width, height },
        pressed && styles.pressed,
      ]}
    >
      <MapBackdrop seed={post.id} width={width} height={height} scale={0.6} />
      {post.courseShared ? (
        <RouteLine
          shape={post.record.shape}
          width={width}
          height={height}
          scale={0.6}
        />
      ) : null}
      <View style={styles.cardShade} pointerEvents="none" />
      <View style={styles.cardAuthor}>
        <Avatar
          nickname={post.author.nickname}
          userId={post.author.userId}
          photo={post.author.profileImageUrl}
          mine={post.isMine}
          size={22}
        />
        <AppText style={styles.cardHandle} numberOfLines={1}>
          {post.author.handle}
        </AppText>
      </View>
      <View style={styles.cardDistance}>
        <Icon name="runner" color={feedLook.route} size={16} />
        <AppText style={styles.cardKm}>
          {formatKm(post.record.distanceM)}
          <AppText style={styles.cardUnit}> km</AppText>
        </AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: look.ground },
  pressed: { opacity: 0.7 },
  loading: { marginTop: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // The same 16 gutter as the search pill, the chips and the grid, so the back button lines up with them (T33).
    paddingHorizontal: gutter,
    paddingBottom: 6,
  },
  title: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    color: look.ink,
  },
  // 시안의 흰 검색 알약.
  field: {
    height: 48,
    marginHorizontal: gutter,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    borderRadius: 24,
    backgroundColor: look.white,
  },
  input: {
    flex: 1,
    paddingVertical: 0,
    fontFamily: fontFamily.regular,
    fontSize: 16,
    color: look.ink,
  },
  // A fixed height: a sideways list sized by its content can come out shorter than its chips.
  chipScroll: { flexGrow: 0, flexShrink: 0, height: 40, marginTop: 12 },
  chips: { gap: 8, paddingHorizontal: gutter, alignItems: 'center' },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    backgroundColor: look.chip,
  },
  chipPicked: { backgroundColor: look.mark },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: look.ink,
  },
  chipTextPicked: { color: look.white },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap,
    paddingHorizontal: gutter,
    paddingTop: 14,
  },
  card: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: feedLook.ground,
  },
  skeleton: { backgroundColor: look.skeleton },
  cardShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  cardAuthor: {
    position: 'absolute',
    top: 10,
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardHandle: {
    flexShrink: 1,
    fontFamily: fontFamily.bold,
    fontSize: 12.5,
    lineHeight: 16,
    color: feedLook.white,
  },
  cardDistance: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardKm: {
    fontFamily: fontFamily.bold,
    letterSpacing: -0.6,
    fontSize: 22,
    lineHeight: 26,
    color: feedLook.white,
  },
  cardUnit: {
    fontFamily: fontFamily.medium,
    fontSize: 11,
    color: feedLook.white,
  },
  section: {
    marginTop: 18,
    marginBottom: 6,
    paddingHorizontal: gutter,
    fontFamily: fontFamily.medium,
    fontSize: 15,
    lineHeight: 20,
    color: look.sub,
  },
  gapRow: { height: 6 },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: gutter,
    paddingVertical: 8,
  },
  mark: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: look.mark,
  },
  crewMark: { borderRadius: 14 },
  nameBox: { flex: 1 },
  name: {
    fontFamily: fontFamily.medium,
    fontSize: 16,
    lineHeight: 22,
    color: look.ink,
  },
  match: { fontFamily: fontFamily.bold },
  personSub: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
  state: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingTop: 56,
    gap: 8,
  },
  stateTitle: {
    marginTop: 8,
    fontFamily: fontFamily.bold,
    fontSize: 17,
    lineHeight: 24,
    color: look.ink,
    textAlign: 'center',
  },
  stateBody: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    color: look.sub,
    textAlign: 'center',
  },
  retry: {
    marginTop: 12,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: look.mark,
  },
  retryText: {
    fontFamily: fontFamily.medium,
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  more: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  moreText: {
    fontFamily: fontFamily.regular,
    fontSize: 13,
    lineHeight: 18,
    color: look.sub,
  },
});
