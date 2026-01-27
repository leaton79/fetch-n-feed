// database.js - IndexedDB storage for Fetch N Feed

import { defaultAppData } from './types.js';

const DB_NAME = 'fetch-n-feed-db';
const DB_VERSION = 1;
const LEGACY_STORAGE_KEY = 'fetch-n-feed-data';

// Object store names
const STORES = {
  feeds: 'feeds',
  articles: 'articles',
  folders: 'folders',
  tags: 'tags',
  notes: 'notes',
  noteTags: 'noteTags',
  filterRules: 'filterRules',
  trainingSignals: 'trainingSignals',
  savedSearches: 'savedSearches',
  preferences: 'preferences',
  meta: 'meta'  // For version, lastSyncedAt, etc.
};

// In-memory cache
let appData = { ...defaultAppData };
let db = null;
let isInitialized = false;

// Generate a unique ID
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

// Get the current timestamp as ISO string
export function now() {
  return new Date().toISOString();
}

// Open/create the IndexedDB database
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log('Database opened successfully');
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      console.log('Creating/upgrading database schema...');
      const database = event.target.result;

      // Create object stores with indexes

      // Feeds store
      if (!database.objectStoreNames.contains(STORES.feeds)) {
        database.createObjectStore(STORES.feeds, { keyPath: 'id' });
      }

      // Articles store with indexes
      if (!database.objectStoreNames.contains(STORES.articles)) {
        const articlesStore = database.createObjectStore(STORES.articles, { keyPath: 'id' });
        articlesStore.createIndex('feedId', 'feedId', { unique: false });
        articlesStore.createIndex('isRead', 'isRead', { unique: false });
        articlesStore.createIndex('isStarred', 'isStarred', { unique: false });
        articlesStore.createIndex('isArchived', 'isArchived', { unique: false });
      }

      // Folders store
      if (!database.objectStoreNames.contains(STORES.folders)) {
        database.createObjectStore(STORES.folders, { keyPath: 'id' });
      }

      // Tags store
      if (!database.objectStoreNames.contains(STORES.tags)) {
        database.createObjectStore(STORES.tags, { keyPath: 'id' });
      }

      // Notes store with index
      if (!database.objectStoreNames.contains(STORES.notes)) {
        const notesStore = database.createObjectStore(STORES.notes, { keyPath: 'id' });
        notesStore.createIndex('articleId', 'articleId', { unique: false });
      }

      // NoteTags store
      if (!database.objectStoreNames.contains(STORES.noteTags)) {
        database.createObjectStore(STORES.noteTags, { keyPath: 'id' });
      }

      // FilterRules store
      if (!database.objectStoreNames.contains(STORES.filterRules)) {
        database.createObjectStore(STORES.filterRules, { keyPath: 'id' });
      }

      // TrainingSignals store
      if (!database.objectStoreNames.contains(STORES.trainingSignals)) {
        database.createObjectStore(STORES.trainingSignals, { keyPath: 'id' });
      }

      // SavedSearches store
      if (!database.objectStoreNames.contains(STORES.savedSearches)) {
        database.createObjectStore(STORES.savedSearches, { keyPath: 'id' });
      }

      // Preferences store (single record)
      if (!database.objectStoreNames.contains(STORES.preferences)) {
        database.createObjectStore(STORES.preferences, { keyPath: 'id' });
      }

      // Meta store (for version, lastSyncedAt)
      if (!database.objectStoreNames.contains(STORES.meta)) {
        database.createObjectStore(STORES.meta, { keyPath: 'key' });
      }

      console.log('Database schema created');
    };
  });
}

// Generic function to get all items from a store
function getAllFromStore(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Generic function to put an item in a store
function putInStore(storeName, item) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generic function to clear a store and add all items
function replaceStoreContents(storeName, items) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    
    // Clear existing data
    const clearRequest = store.clear();
    
    clearRequest.onsuccess = () => {
      // Add all items
      let completed = 0;
      const total = items.length;
      
      if (total === 0) {
        resolve();
        return;
      }

      items.forEach(item => {
        const addRequest = store.put(item);
        addRequest.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve();
          }
        };
        addRequest.onerror = () => reject(addRequest.error);
      });
    };
    
    clearRequest.onerror = () => reject(clearRequest.error);
  });
}

// Check for and migrate data from localStorage
async function migrateFromLocalStorage() {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) {
      console.log('No localStorage data to migrate');
      return null;
    }

    console.log('Found localStorage data, migrating to IndexedDB...');
    const parsed = JSON.parse(stored);
    
    // Merge with defaults to ensure all fields exist
    const migratedData = {
      ...defaultAppData,
      ...parsed,
      preferences: { ...defaultAppData.preferences, ...parsed.preferences }
    };

    return migratedData;
  } catch (error) {
    console.error('Failed to parse localStorage data:', error);
    return null;
  }
}

// Load all data from IndexedDB into memory
async function loadFromIndexedDB() {
  const [
    feeds,
    articles,
    folders,
    tags,
    notes,
    noteTags,
    filterRules,
    trainingSignals,
    savedSearches,
    preferencesArray,
    metaArray
  ] = await Promise.all([
    getAllFromStore(STORES.feeds),
    getAllFromStore(STORES.articles),
    getAllFromStore(STORES.folders),
    getAllFromStore(STORES.tags),
    getAllFromStore(STORES.notes),
    getAllFromStore(STORES.noteTags),
    getAllFromStore(STORES.filterRules),
    getAllFromStore(STORES.trainingSignals),
    getAllFromStore(STORES.savedSearches),
    getAllFromStore(STORES.preferences),
    getAllFromStore(STORES.meta)
  ]);

  // Extract preferences (stored as single object with id)
  const preferences = preferencesArray.length > 0 
    ? { ...defaultAppData.preferences, ...preferencesArray[0] }
    : { ...defaultAppData.preferences };
  delete preferences.id; // Remove the id we added for storage

  // Extract meta values
  const meta = {};
  metaArray.forEach(item => {
    meta[item.key] = item.value;
  });

  return {
    version: meta.version || defaultAppData.version,
    lastSyncedAt: meta.lastSyncedAt || null,
    feeds,
    articles,
    folders,
    tags,
    notes,
    noteTags,
    filterRules,
    trainingSignals,
    savedSearches,
    preferences
  };
}

// Save all data from memory to IndexedDB
async function saveToIndexedDB() {
  try {
    await Promise.all([
      replaceStoreContents(STORES.feeds, appData.feeds),
      replaceStoreContents(STORES.articles, appData.articles),
      replaceStoreContents(STORES.folders, appData.folders),
      replaceStoreContents(STORES.tags, appData.tags),
      replaceStoreContents(STORES.notes, appData.notes),
      replaceStoreContents(STORES.noteTags, appData.noteTags),
      replaceStoreContents(STORES.filterRules, appData.filterRules),
      replaceStoreContents(STORES.trainingSignals, appData.trainingSignals),
      replaceStoreContents(STORES.savedSearches, appData.savedSearches),
      // Preferences stored as single object with id
      replaceStoreContents(STORES.preferences, [{ id: 'main', ...appData.preferences }]),
      // Meta values
      replaceStoreContents(STORES.meta, [
        { key: 'version', value: appData.version },
        { key: 'lastSyncedAt', value: appData.lastSyncedAt }
      ])
    ]);
    return true;
  } catch (error) {
    console.error('Failed to save to IndexedDB:', error);
    return false;
  }
}

// Initialize the database and load data
export async function loadData() {
  try {
    // Open/create database
    db = await openDatabase();

    // Check for localStorage data to migrate
    const migratedData = await migrateFromLocalStorage();

    if (migratedData) {
      // Use migrated data
      appData = migratedData;
      
      // Save to IndexedDB
      await saveToIndexedDB();
      
      // Clear localStorage after successful migration
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      console.log('Migration complete. localStorage data cleared.');
      console.log('Data loaded:', appData.feeds.length, 'feeds,', appData.articles.length, 'articles');
    } else {
      // Load from IndexedDB
      const loadedData = await loadFromIndexedDB();
      
      // Check if we have any data
      if (loadedData.feeds.length > 0 || loadedData.articles.length > 0) {
        appData = loadedData;
        console.log('Data loaded from IndexedDB:', appData.feeds.length, 'feeds,', appData.articles.length, 'articles');
      } else {
        // No data anywhere, use defaults
        appData = { ...defaultAppData };
        console.log('No existing data, using defaults');
      }
    }

    isInitialized = true;
    return appData;
  } catch (error) {
    console.error('Failed to load data:', error);
    appData = { ...defaultAppData };
    isInitialized = true;
    return appData;
  }
}

// Save data to IndexedDB
export async function saveData() {
  if (!db) {
    console.error('Database not initialized. Call loadData() first.');
    return false;
  }

  appData.lastSyncedAt = now();

  try {
    await saveToIndexedDB();
    console.log('Data saved successfully');
    return true;
  } catch (error) {
    console.error('Failed to save data:', error);
    return false;
  }
}

// Get the current data (from memory)
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
      appData = {
        ...defaultAppData,
        ...imported,
        preferences: { ...defaultAppData.preferences, ...imported.preferences }
      };
      await saveData();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// Clear all data
export async function clearData() {
  appData = { ...defaultAppData };
  
  if (db) {
    try {
      await saveToIndexedDB();
    } catch (error) {
      console.error('Failed to clear IndexedDB:', error);
    }
  }
  
  // Also clear any remaining localStorage
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  console.log('Data cleared');
}

// Check if database is initialized
export function isReady() {
  return isInitialized;
}