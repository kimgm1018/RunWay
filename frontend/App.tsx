import React, { useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from './src/components';
import { appConfig } from './src/config';
import {
  createRepositories,
  DataProvider,
  type Repositories,
} from './src/data';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SessionProvider } from './src/session/SessionProvider';
import { ThemeProvider, type ThemePreference } from './src/theme';

export default function App({
  repositories,
  initialSignedIn = false,
  initialTheme = 'system',
}: {
  repositories?: Repositories;
  initialSignedIn?: boolean;
  initialTheme?: ThemePreference;
}) {
  const data = useMemo(
    () => repositories ?? createRepositories(appConfig.dataSource),
    [repositories],
  );
  return (
    <SafeAreaProvider>
      <ThemeProvider initialPreference={initialTheme}>
        <DataProvider repositories={data}>
          <SessionProvider initialSignedIn={initialSignedIn}>
            <ToastProvider>
              <RootNavigator />
            </ToastProvider>
          </SessionProvider>
        </DataProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
