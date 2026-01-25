// main.js - Fetch N Feed entry point

import { loadData, getData, exportData } from './database.js';
import { addFeed, getAllFeeds, addFolder, getAllFolders, addTag, getAllTags } from './feedManager.js';

async function init() {
  console.log('Fetch N Feed starting...');
  await loadData();
  console.log('Data loaded:', getData());
  renderApp();
}

function renderApp() {
  const app = document.querySelector('#app');
  if (!app) return;
  
  app.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; max-width: 600px; margin: 0 auto;">
      <h1 style="margin-bottom: 8px;">Fetch N Feed</h1>
      <p style="color: #666; margin-bottom: 24px;">Data Layer Test</p>
      
      <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 24px;">
        <button id="btn-add-feed" style="padding: 12px; font-size: 14px; cursor: pointer;">Add Test Feed</button>
        <button id="btn-add-folder" style="padding: 12px; font-size: 14px; cursor: pointer;">Add Test Folder</button>
        <button id="btn-add-tag" style="padding: 12px; font-size: 14px; cursor: pointer;">Add Test Tag</button>
        <button id="btn-show-data" style="padding: 12px; font-size: 14px; cursor: pointer;">Show Current Data</button>
        <button id="btn-clear-output" style="padding: 12px; font-size: 14px; cursor: pointer;">Clear Output</button>
      </div>
      
      <div style="background: #f5f5f5; border-radius: 8px; padding: 16px;">
        <h3 style="margin-top: 0;">Output:</h3>
        <pre id="output" style="white-space: pre-wrap; word-break: break-all; font-size: 12px; margin: 0;"></pre>
      </div>
    </div>
  `;
  
  document.getElementById('btn-add-feed').addEventListener('click', async () => {
    const feeds = [
      { url: 'https://feeds.arstechnica.com/arstechnica/index', title: 'Ars Technica' },
      { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge' },
      { url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', title: 'NY Times' },
    ];
    const existing = getAllFeeds();
    const next = feeds[existing.length % feeds.length];
    const feed = await addFeed(next.url, next.title);
    document.getElementById('output').textContent = '✓ Added feed:\n\n' + JSON.stringify(feed, null, 2) + '\n\nTotal feeds: ' + getAllFeeds().length;
  });

  document.getElementById('btn-add-folder').addEventListener('click', async () => {
    const names = ['News', 'Tech', 'Science', 'Personal', 'Work'];
    const existing = getAllFolders();
    const folder = await addFolder(names[existing.length % names.length]);
    document.getElementById('output').textContent = '✓ Added folder:\n\n' + JSON.stringify(folder, null, 2) + '\n\nTotal folders: ' + getAllFolders().length;
  });

  document.getElementById('btn-add-tag').addEventListener('click', async () => {
    const names = ['important', 'read-later', 'reference', 'project', 'inspiration'];
    const colors = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa'];
    const existing = getAllTags();
    const i = existing.length % names.length;
    const tag = await addTag(names[i], colors[i]);
    document.getElementById('output').textContent = '✓ Added tag:\n\n' + JSON.stringify(tag, null, 2) + '\n\nTotal tags: ' + getAllTags().length;
  });

  document.getElementById('btn-show-data').addEventListener('click', () => {
    document.getElementById('output').textContent = exportData();
  });

  document.getElementById('btn-clear-output').addEventListener('click', () => {
    document.getElementById('output').textContent = '';
  });
}

init();