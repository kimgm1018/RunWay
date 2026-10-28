import React, { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Icon, IconButton, TextField } from '../../components';
import { useRepositories, type MeetingPlace } from '../../data';
import { radius, size, spacing, typography, useTheme } from '../../theme';
import { MockMap } from '../run/MockMap';
import { FooterButton } from './GroupRunDetailScreen';
import { Tag, useGroupRunDraft } from './parts';

const formatDistance = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${meters}m`;

// 6.9 만남 장소 선택 and 6.9b 장소 확정. Until the map SDK (S15P31E105-180) the place is picked
// from search results instead of by dragging the map.
export function MeetingPlaceScreen() {
  const navigation = useNavigation();
  const { colors, name } = useTheme();
  const { groupRuns } = useRepositories();
  const { draft, setPlace } = useGroupRunDraft();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[]>([]);
  const [picked, setPicked] = useState<MeetingPlace | null>(draft.place);
  const [confirming, setConfirming] = useState(false);
  const [placeName, setPlaceName] = useState('');
  const [note, setNote] = useState(draft.place?.note ?? '');

  const search = useCallback(
    (text: string) => {
      groupRuns.searchPlaces(text).then(found => {
        setResults(found);
        setPicked(current => current ?? found[0] ?? null);
      });
    },
    [groupRuns],
  );
  useEffect(() => search(''), [search]);

  const choose = (place: MeetingPlace) => {
    setPicked(place);
    setQuery('');
    search('');
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={colors.statusBar} />
      <MockMap
        night={name === 'dark'}
        position={picked?.position}
        positionY={340}
      />
      {/* The pin stands on the picked point (the map's position dot). */}
      <View style={styles.pinLayer} pointerEvents="none">
        <View style={styles.pin}>
          {!confirming ? (
            <View
              style={[styles.tip, { backgroundColor: colors.surfaceRaised }]}
            >
              <AppText variant="label">
                장소를 검색하거나 아래에서 고르세요
              </AppText>
            </View>
          ) : null}
          <Icon
            name="mapPin"
            color={colors.accent}
            size={44}
            strokeWidth={2.4}
          />
        </View>
      </View>
      <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
        <View style={styles.searchRow}>
          <IconButton
            icon="back"
            accessibilityLabel="뒤로"
            onPress={() => navigation.goBack()}
          />
          <View
            style={[
              styles.search,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            <Icon name="search" color={colors.textTertiary} size={16} />
            <TextInput
              accessibilityLabel="장소·주소 검색"
              placeholder="장소·주소 검색"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={text => {
                setQuery(text);
                setConfirming(false);
                search(text);
              }}
              style={[styles.searchInput, { color: colors.text }]}
            />
          </View>
        </View>
        {query ? (
          <View
            style={[
              styles.results,
              {
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
              },
            ]}
          >
            {results.length ? (
              results.map(place => (
                <Pressable
                  key={place.name}
                  accessibilityRole="button"
                  accessibilityLabel={place.name}
                  onPress={() => choose(place)}
                  style={styles.result}
                >
                  <Icon name="mapPin" color={colors.textSecondary} size={16} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{place.name}</AppText>
                    <AppText variant="caption" tone="textTertiary">
                      {place.address}
                    </AppText>
                  </View>
                  <AppText variant="label" tone="textTertiary">
                    {formatDistance(place.distanceM)}
                  </AppText>
                </Pressable>
              ))
            ) : (
              <AppText
                variant="caption"
                tone="textTertiary"
                style={styles.noResult}
              >
                찾는 장소가 없어요
              </AppText>
            )}
          </View>
        ) : null}
        {!confirming && !query ? (
          <View style={styles.locate}>
            <IconButton
              icon="locate"
              accessibilityLabel="내 위치로"
              onPress={() => results[0] && choose(results[0])}
            />
          </View>
        ) : null}
      </SafeAreaView>
      <SafeAreaView
        edges={['bottom']}
        style={[
          styles.sheet,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
        ]}
      >
        <View
          style={[styles.handle, { backgroundColor: colors.borderStrong }]}
        />
        {confirming && picked ? (
          <View style={styles.sheetBody}>
            <View style={styles.confirmed}>
              <Tag label="✓ 위치 확정" tone="muted" />
              <AppText
                variant="caption"
                tone="textSecondary"
                numberOfLines={1}
                style={styles.flex}
              >
                {picked.address}
              </AppText>
            </View>
            <TextField
              label="장소 이름"
              value={placeName}
              onChangeText={setPlaceName}
            />
            <TextField
              label="찾아오는 법 · 선택"
              placeholder="예: 편의점 앞 계단, 민트색 모자"
              value={note}
              onChangeText={setNote}
            />
            <View style={styles.buttons}>
              <FooterButton
                title="다시 고르기"
                onPress={() => setConfirming(false)}
              />
              <FooterButton
                title="확정"
                primary
                disabled={!placeName.trim()}
                onPress={() => {
                  setPlace({
                    ...picked,
                    name: placeName.trim(),
                    note: note.trim() || null,
                  });
                  navigation.goBack();
                }}
              />
            </View>
          </View>
        ) : (
          <View style={styles.sheetBody}>
            {!query ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.nearby}
              >
                {results.map(place => {
                  const selected = place.name === picked?.name;
                  return (
                    <Pressable
                      key={place.name}
                      accessibilityRole="radio"
                      accessibilityLabel={place.name}
                      accessibilityState={{ selected }}
                      onPress={() => setPicked(place)}
                      style={[
                        styles.nearbyChip,
                        selected
                          ? {
                              backgroundColor: colors.accent,
                              borderColor: colors.accent,
                            }
                          : { borderColor: colors.borderStrong },
                      ]}
                    >
                      <AppText
                        variant="captionStrong"
                        style={{
                          color: selected ? colors.onAccent : colors.text,
                        }}
                      >
                        {place.name}
                      </AppText>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
            {picked ? (
              <View style={styles.pickedRow}>
                <Icon name="mapPin" color={colors.accentText} size={18} />
                <View style={styles.flex}>
                  <AppText variant="heading">{picked.name}</AppText>
                  <AppText variant="caption" tone="textTertiary">
                    {picked.address}
                  </AppText>
                </View>
                <AppText variant="captionStrong" tone="textSecondary">
                  {formatDistance(picked.distanceM)}
                </AppText>
              </View>
            ) : null}
            <FooterButton
              title="이 위치로 정하기"
              primary
              disabled={!picked}
              onPress={() => {
                setPlaceName(picked?.name ?? '');
                setConfirming(true);
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  pinLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
  },
  // MockMap draws the picked point at y=340 of its 760-high frame.
  pin: {
    position: 'absolute',
    top: '44.7%',
    alignItems: 'center',
    // The pin's tip lands on the point; the tooltip floats above the pin.
    transform: [{ translateY: -42 }],
  },
  tip: {
    position: 'absolute',
    bottom: 52,
    width: 240,
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  searchRow: {
    height: size.header,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.screen,
  },
  search: {
    flex: 1,
    height: size.iconButton,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  // Without a lineHeight, as in TextField, so the glyphs are not clipped.
  searchInput: {
    flex: 1,
    height: size.iconButton,
    fontFamily: typography.input.fontFamily,
    fontSize: typography.input.fontSize,
    paddingVertical: 0,
    textAlignVertical: 'center',
  },
  results: {
    marginHorizontal: spacing.screen,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  noResult: { padding: spacing.xl, textAlign: 'center' },
  locate: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.screen,
    marginTop: 260,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: spacing.md,
  },
  sheetBody: { padding: spacing.screen, gap: spacing.xl },
  nearby: { gap: spacing.md },
  nearbyChip: {
    height: 32,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xl },
  confirmed: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.md },
});
