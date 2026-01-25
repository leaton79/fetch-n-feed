// database.js - Save and load data for Fetch N Feed

import { defaultAppData } from './types.js';

const DATA_FILE_NAME = 'fetch-n-feed-data.json';

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

// Check if we're running in Tauri (desktop) or browser
function isTauri() {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

// Get the path to the data file
async function getDataFilePath() {
  if (!isTauri()) {
    return DATA_FILE_NAME;
  }
  
  const tauri = window.__TAURI__;
  
  // Check if user has set a custom sync folder
  if (appData.preferences.syncFolderPath) {
    return `${appData.preferences.syncFolderPath}/${DATA_FILE_NAME}`;
  }
  
  // Default to app data directory
  const appDataDir = await tauri.path.appDataDir();
  return `${appDataDir}${DATA_FILE_NAME}`;
}

// Save data to file
export async function saveData() {
  appData.lastSyncedAt = now();
  
  if (!isTauri()) {
    // Browser fallback: use localStorage
    try {
      localStorage.setItem(DATA_FILE_NAME, JSON.stringify(appData, null, 2));
      console.log('Data saved to localStorage');
      return true;
    } catch (error) {
      console.error('Failed to save to localStorage:', error);
      return false;
    }
  }
  
  try {
    const tauri = window.__TAURI__;
    const filePath = await getDataFilePath();
    
    // Ensure directory exists
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    try {
      await tauri.fs.mkdir(dir, { recursive: true });
    } catch {
      // Directory might already exist, that's fine
    }
    
    // Write the file
    await tauri.fs.writeTextFile(filePath, JSON.stringify(appData, null, 2));
    console.log('Data saved to:', filePath);
    return true;
  } catch (error) {
    console.error('Failed to save data:', error);
    return false;
  }
}

// Load data from file
export async function loadData() {
  if (!isTauri()) {
    // Browser fallback: use localStorage
    try {
      const stored = localStorage.getItem(DATA_FILE_NAME);
      if (stored) {
        appData = JSON.parse(stored);
        console.log('Data loaded from localStorage');
      }
    } catch (error) {
      console.error('Failed to load from localStorage:', error);
    }
    return appData;
  }
  
  try {
    const tauri = window.__TAURI__;
    const filePath = await getDataFilePath();
    
    const content = await tauri.fs.readTextFile(filePath);
    appData = JSON.parse(content);
    console.log('Data loaded from:', filePath);
  } catch (error) {
    // File doesn't exist yet, use defaults
    console.log('No existing data file, using defaults');
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

// Set the sync folder path
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