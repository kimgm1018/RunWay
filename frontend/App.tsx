import React, { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from './src/components';
import { appConfig } from './src/config';
import {
  createRepositories,
  DataProvider,
  type Repositories,
} from './src/data';
import { refreshWatchHealthConsent } from './src/health/watchHealth';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SessionProvider } from './src/session/SessionProvider';
import { ThemeProvider } from './src/theme';

export default function App({
  repositories,
  initialSignedIn = false,
}: {
  repositories?: Repositories;
  initialSignedIn?: boolean;
}) {
  const data = useMemo(
    () => repositories ?? createRepositories(appConfig.dataSource),
    [repositories],
  );
  useEffect(() => {
    // W05 (S15P31E105-250) will pass a server consent reader here.
    void refreshWatchHealthConsent();
  }, []);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
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
