export type DataSource = 'mock';

export const appConfig = {
  // Screens read data through src/data repositories; add 'api' here when the backend endpoints are ready.
  dataSource: 'mock' as DataSource,
  // The installed Android build bundles JS without __DEV__, so the developer menu is a flag; turn it off before release.
  developerMenu: true,
};
