// database.js - Save and load data for Fetch N Feed

import { defaultAppData } from './types.js';

const DATA_FILE_NAME = 'fetch-n-feed-data.json';
const STORAGE_KEY = 'fetch-n-feed-data';

// Generate a unique ID
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Get the current timestamp as ISO string
export function now() {
  return new Date().toISOString();
}

// In-memory data store
let appData = { ...defaultAppData };

// Save data to localStorage
export async function saveData() {
  appData.lastSyncedAt = now();
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
    console.log('Data saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save data:', error);
    return false;
  }
}

// Load data from localStorage
export async function loadData() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure all fields exist
      appData = { 
        ...defaultAppData, 
        ...parsed,
        preferences: { ...defaultAppData.preferences, ...parsed.preferences }
      };
      console.log('Data loaded successfully:', appData.feeds.length, 'feeds,', appData.articles.length, 'articles');
    } else {
      console.log('No existing data, using defaults');
      appData = { ...defaultAppData };
    }
  } catch (error) {
    console.error('Failed to load data:', error);
    appData = { ...defaultAppData };
  }
  
  return appData;
}

// Get the current data (in memory)
export function getData() {
  return appData;
}

// Update data and save
export async function updateData(updates) {
  appData = { ...appData, ...updates };
  await saveData();
}

// Set the sync folder path (for future Google Drive sync)
export async function setSyncFolder(folderPath) {
  appData.preferences.syncFolderPath = folderPath;
  await saveData();
}

// Export data as JSON string (for manual backup)
export function exportData() {
  return JSON.stringify(appData, null, 2);
}

// Import data from JSON string
export async function importData(jsonString) {
  try {
    const imported = JSON.parse(jsonString);
    if (imported.version && imported.feeds && imported.articles) {
      appData = imported;
      await saveData();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Clear all data (for testing)
export async function clearData() {
  appData = { ...defaultAppData };
  localStorage.removeItem(STORAGE_KEY);
  console.log('Data cleared');
}