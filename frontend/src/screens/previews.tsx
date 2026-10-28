import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { AppText, Button, Card } from '../components';
import { appConfig } from '../config';
import { spacing, useThemeSettings, type ThemePreference } from '../theme';

const preferences: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: '기기 설정' },
  { value: 'dark', label: '다크' },
  { value: 'light', label: '라이트' },
];

export function SettingsPreview() {
  const navigation = useNavigation();
  const { preference, setPreference } = useThemeSettings();
  return (
    <>
      <Card>
        <AppText variant="bodyStrong">화면 모드</AppText>
        <View style={styles.row}>
          {preferences.map(option => (
            <Button
              key={option.value}
              title={option.label}
              size="small"
              variant={preference === option.value ? 'primary' : 'secondary'}
              onPress={() => setPreference(option.value)}
              style={styles.flex}
            />
          ))}
        </View>
      </Card>
      {appConfig.developerMenu ? (
        <Card>
          <AppText variant="bodyStrong">개발용</AppText>
          <Button
            title="공통 컴포넌트 미리보기"
            variant="secondary"
            size="medium"
            onPress={() => navigation.navigate('ComponentGallery')}
          />
          <Button
            title="건강 데이터 PoC"
            variant="secondary"
            size="medium"
            onPress={() => navigation.navigate('HealthPoc')}
          />
        </Card>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
