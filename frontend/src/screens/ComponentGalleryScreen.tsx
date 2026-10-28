import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  AppText,
  BottomSheet,
  Button,
  Card,
  EmptyState,
  IconButton,
  Screen,
  ScreenHeader,
  TextField,
  useToast,
} from '../components';
import { spacing } from '../theme';

// Developer screen to check every shared component in the current theme.
export function ComponentGalleryScreen() {
  const navigation = useNavigation();
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <Screen
      header={
        <ScreenHeader
          title="공통 컴포넌트"
          onBack={navigation.goBack}
          right={<IconButton icon="bell" accessibilityLabel="알림" badge />}
        />
      }
    >
      <AppText variant="heading">버튼</AppText>
      <Button title="러닝 시작" icon="play" />
      <Button title="닫기" variant="secondary" />
      <Button title="로그인 중" variant="inverse" loading />
      <Button title="가입 신청 · 정원 마감" disabled />
      <Button title="다시 연결" variant="danger" size="medium" />
      <Button title="비밀번호를 잊으셨나요?" variant="text" size="small" />

      <AppText variant="heading">입력창</AppText>
      <TextField label="아이디" placeholder="영문·숫자 4–16자" />
      <TextField
        label="아이디"
        defaultValue="minjun_run"
        status="success"
        helper="사용할 수 있는 아이디예요"
      />
      <TextField
        label="인증번호"
        defaultValue="123456"
        status="error"
        helper="인증번호가 맞지 않아요 (남은 횟수 3회)"
      />

      <AppText variant="heading">카드</AppText>
      <Card>
        <AppText variant="caption" tone="textTertiary">
          오늘의 준비도
        </AppText>
        <AppText variant="metricHero">82</AppText>
      </Card>
      <Card variant="outline">
        <AppText variant="bodyStrong">곧 출발하는 그룹런</AppText>
      </Card>
      <View style={styles.row}>
        <Card variant="muted" style={styles.flex}>
          <AppText variant="label" tone="textTertiary">
            수면
          </AppText>
          <AppText variant="metric">7h 12m</AppText>
        </Card>
        <Card variant="solid" style={styles.flex}>
          <AppText variant="label" tone="textTertiary">
            안정 심박
          </AppText>
          <AppText variant="metric">58</AppText>
        </Card>
      </View>

      <AppText variant="heading">빈 상태</AppText>
      <EmptyState
        title="받은 알림이 없어요"
        description="그룹런과 크루 소식이 오면 여기에 모여요"
      />
      <EmptyState
        dashed
        icon="run"
        title="첫 러닝을 기록해 보세요"
        actionLabel="첫 러닝 시작"
        onAction={() => {}}
      />

      <AppText variant="heading">바텀시트·토스트</AppText>
      <Button
        title="바텀시트 열기"
        variant="secondary"
        onPress={() => setSheetOpen(true)}
      />
      <Button
        title="토스트 띄우기"
        variant="secondary"
        onPress={() =>
          toast('워치 연결을 해제했어요', {
            actionLabel: '되돌리기',
            onAction: () => {},
          })
        }
      />
      <BottomSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="정원이 가득 찼어요"
        description="자리가 나면 다시 신청할 수 있어요."
      >
        <View style={styles.row}>
          <Button
            title="닫기"
            variant="secondary"
            onPress={() => setSheetOpen(false)}
          />
          <Button
            title="다른 크루 둘러보기"
            onPress={() => setSheetOpen(false)}
            style={styles.flex}
          />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
