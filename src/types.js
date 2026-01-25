// types.js - Data structures for Fetch N Feed

// Default empty state
export const defaultAppData = {
  version: 1,
  feeds: [],
  articles: [],
  folders: [],
  tags: [],
  filterRules: [],
  trainingSignals: [],
  savedSearches: [],
  preferences: {
    globalRefreshInterval: 10080, // weekly in minutes
    defaultView: 'list',
    theme: 'system',
    articleRetentionDays: 30,
    notificationsEnabled: true,
    ttsSpeed: 1.0,
  },
};