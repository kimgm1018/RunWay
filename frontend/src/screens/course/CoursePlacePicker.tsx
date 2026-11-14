import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, TextField } from '../../components';
import { KeyboardLift } from '../../components/KeyboardLift';
import { RunMap } from '../../components/RunMap';
import { useRepositories, type MeetingPlace, type Place } from '../../data';
import { placeNameOf } from '../../data/placeName';
import { ThemeProvider } from '../../theme';
import { PLACE_SEARCH_MAX } from '../inputLimits';
import {
  CURRENT_PLACE_NAME,
  locationFailureNotice,
  noLocationNotice,
} from './currentLocation';
import type { RecommendNotice } from './recommendFailure';

type PickedPlace = Place & { address?: string };

// 선택 중인 좌표는 화면 안에만 보관하고 확정할 때 추천 조건에 전달한다.
export function CoursePlacePicker({
  kind,
  selected,
  reference,
  onConfirm,
  onCancel,
}: {
  kind: 'origin' | 'destination';
  selected: Place | null;
  reference: Place | null;
  onConfirm: (place: Place) => void;
  onCancel: () => void;
}) {
  const { groupRuns, phoneLocation } = useRepositories();
  const [picked, setPicked] = useState<PickedPlace | null>(selected);
  const [mapPoint, setMapPoint] = useState<Place['position'] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MeetingPlace[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<RecommendNotice | null>(null);
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionVersion.current += 1;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setResults(null);
    setFailed(false);
    if (!query.trim()) return;
    const timer = setTimeout(() => {
      groupRuns.searchPlaces(query.trim(), reference?.position).then(
        found => {
          if (live) setResults(found);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [groupRuns, query, reference, attempt]);

  const choose = (value: PickedPlace) => {
    selectionVersion.current += 1;
    setMapPoint(null);
    setPicked(value);
    setNotice(null);
    setQuery('');
    Keyboard.dismiss();
  };

  useEffect(() => {
    if (!mapPoint) return;
    let live = true;
    placeNameOf(mapPoint).then(name => {
      if (live && name)
        setPicked(current =>
          current?.position === mapPoint ? { ...current, name } : current,
        );
    });
    return () => {
      live = false;
    };
  }, [mapPoint]);

  const locate = async () => {
    if (!phoneLocation) {
      setNotice(noLocationNotice);
      return;
    }
    const version = ++selectionVersion.current;
    setLocating(true);
    setNotice(null);
    try {
      const fix = await phoneLocation.current();
      if (!mounted.current || selectionVersion.current !== version) return;
      choose({
        name: CURRENT_PLACE_NAME,
        position: [fix.longitude, fix.latitude],
      });
    } catch (error) {
      if (mounted.current && selectionVersion.current === version)
        setNotice(locationFailureNotice(error));
    } finally {
      if (mounted.current) setLocating(false);
    }
  };

  return (
    <Modal animationType="slide" onRequestClose={onCancel}>
      <ThemeProvider tone="light">
        <View style={styles.root}>
          <RunMap
            position={picked?.position ?? reference?.position}
            area={{ top: 0.5, bottom: 0.5 }}
            // The picked point as the run map's mint pin (S15P31E105-683, 담당자 요청).
            look="mint"
            cameraLocked={mapPoint !== null}
            onTapMap={position => {
              if (
                !Number.isFinite(position[0]) ||
                !Number.isFinite(position[1]) ||
                Math.abs(position[0]) > 180 ||
                Math.abs(position[1]) > 90
              )
                return;
              choose({ name: '지도에서 고른 위치', position });
              setMapPoint(position);
            }}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView style={styles.flex} pointerEvents="box-none">
            <View style={styles.header}>
              <AppText variant="heading" accessibilityRole="header">
                {kind === 'origin' ? '출발 위치 선택' : '도착 위치 선택'}
              </AppText>
              <Button
                title="취소"
                variant="text"
                size="small"
                onPress={onCancel}
              />
            </View>
            <KeyboardLift style={styles.flex} pointerEvents="box-none">
              <View style={styles.search}>
                <TextField
                  accessibilityLabel="장소·주소 검색"
                  placeholder="장소·주소 검색"
                  value={query}
                  maxLength={PLACE_SEARCH_MAX}
                  onChangeText={text => {
                    setQuery(text);
                    setResults(null);
                    setFailed(false);
                  }}
                  returnKeyType="search"
                />
                <Button
                  title={locating ? '현재 위치 찾는 중…' : '현재 위치'}
                  variant="secondary"
                  size="small"
                  disabled={locating}
                  onPress={locate}
                />
                {query.trim() ? (
                  <ScrollView
                    style={styles.results}
                    keyboardShouldPersistTaps="handled"
                  >
                    {failed ? (
                      <View>
                        <AppText tone="textSecondary">
                          장소를 검색하지 못했어요.
                        </AppText>
                        <Button
                          title="장소 검색 다시 시도"
                          variant="text"
                          size="small"
                          onPress={() => setAttempt(value => value + 1)}
                        />
                      </View>
                    ) : results === null ? (
                      <AppText tone="textSecondary">검색 중이에요</AppText>
                    ) : results.length === 0 ? (
                      <AppText tone="textSecondary">
                        검색 결과가 없어요. 다른 이름이나 주소로 찾아보세요.
                      </AppText>
                    ) : (
                      results.map(item => (
                        <Pressable
                          key={`${item.name}|${
                            item.address
                          }|${item.position.join(',')}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${item.name}, ${item.address}`}
                          onPress={() => choose(item)}
                          style={styles.result}
                        >
                          <AppText numberOfLines={1}>{item.name}</AppText>
                          <AppText tone="textSecondary" numberOfLines={1}>
                            {item.address}
                          </AppText>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                ) : null}
              </View>
              <View style={styles.mapSpace} pointerEvents="box-none">
                <View pointerEvents="none" style={styles.hint}>
                  <AppText>지도를 눌러 위치를 고를 수 있어요</AppText>
                </View>
              </View>
              <View style={styles.selection}>
                {notice ? (
                  <AppText tone="danger">
                    {notice.title} {notice.detail}
                  </AppText>
                ) : null}
                {picked ? (
                  <>
                    <AppText variant="heading" numberOfLines={1}>
                      {picked.name}
                    </AppText>
                    {picked.address ? (
                      <AppText tone="textSecondary" numberOfLines={1}>
                        {picked.address}
                      </AppText>
                    ) : null}
                  </>
                ) : (
                  <AppText>검색하거나 지도에서 위치를 골라 주세요</AppText>
                )}
                <Button
                  title="이 위치로 확정"
                  disabled={!picked}
                  onPress={() =>
                    picked &&
                    onConfirm({ name: picked.name, position: picked.position })
                  }
                />
              </View>
            </KeyboardLift>
          </SafeAreaView>
        </View>
      </ThemeProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F5F6' },
  flex: { flex: 1 },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  search: {
    margin: 12,
    padding: 12,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
  },
  results: { maxHeight: 160 },
  result: { paddingVertical: 12, gap: 4 },
  mapSpace: { flex: 1, minHeight: 40, alignItems: 'center' },
  hint: { padding: 8, borderRadius: 12, backgroundColor: '#FFFFFF' },
  selection: {
    margin: 12,
    padding: 16,
    gap: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
});
