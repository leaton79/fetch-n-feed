// main.js - Fetch N Feed entry point

import { loadData, getData, exportData } from './database.js';
import { addFeed, getAllFeeds, getAllArticles, getArticlesByFeed, deleteFeed, markArticleRead, refreshFeed, refreshAllFeeds } from './feedManager.js';

let currentFeedId = null;

async function init() {
  console.log('Fetch N Feed starting...');
  await loadData();
  renderApp();
}

function renderApp() {
  const app = document.querySelector('#app');
  if (!app) return;
  
  app.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; height: 100vh;">
      
      <!-- Sidebar -->
      <div style="width: 250px; background: #f5f5f5; padding: 16px; border-right: 1px solid #ddd; overflow-y: auto;">
        <h2 style="margin: 0 0 16px 0; font-size: 18px;">Fetch N Feed</h2>
        
        <div style="margin-bottom: 16px;">
          <input type="text" id="feed-url-input" placeholder="Enter RSS feed URL..." 
            style="width: 100%; padding: 8px; font-size: 14px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; margin-bottom: 8px;">
          <button id="btn-add-feed" style="width: 100%; padding: 8px; font-size: 14px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 4px;">
            Add Feed
          </button>
        </div>
        
        <button id="btn-refresh-all" style="width: 100%; padding: 8px; font-size: 14px; cursor: pointer; margin-bottom: 16px; background: #34c759; color: white; border: none; border-radius: 4px;">
          ↻ Refresh All Feeds
        </button>
        
        <div style="margin-bottom: 8px;">
          <a href="#" id="btn-all-articles" style="display: block; padding: 8px; background: ${currentFeedId === null ? '#007aff' : 'transparent'}; color: ${currentFeedId === null ? 'white' : '#333'}; text-decoration: none; border-radius: 4px;">
            All Articles
          </a>
        </div>
        
        <div style="font-size: 12px; color: #666; margin-bottom: 8px; text-transform: uppercase;">Feeds</div>
        <div id="feeds-list"></div>
      </div>
      
      <!-- Main Content -->
      <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <div id="status-bar" style="padding: 8px 16px; background: #f9f9f9; border-bottom: 1px solid #ddd; font-size: 12px; color: #666;"></div>
        <div id="articles-list" style="flex: 1; overflow-y: auto; padding: 16px;"></div>
      </div>
      
    </div>
  `;
  
  document.getElementById('btn-add-feed').addEventListener('click', handleAddFeed);
  document.getElementById('btn-refresh-all').addEventListener('click', handleRefreshAll);
  document.getElementById('btn-all-articles').addEventListener('click', (e) => {
    e.preventDefault();
    currentFeedId = null;
    renderApp();
  });
  
  renderFeedsList();
  renderArticles();
}

function renderFeedsList() {
  const container = document.getElementById('feeds-list');
  const feeds = getAllFeeds();
  
  if (feeds.length === 0) {
    container.innerHTML = '<div style="color: #999; font-size: 14px; padding: 8px;">No feeds yet. Add one above!</div>';
    return;
  }
  
  container.innerHTML = feeds.map(feed => `
    <div style="display: flex; align-items: center; margin-bottom: 4px;">
      <a href="#" class="feed-link" data-feed-id="${feed.id}" 
        style="flex: 1; padding: 8px; background: ${currentFeedId === feed.id ? '#007aff' : 'transparent'}; color: ${currentFeedId === feed.id ? 'white' : '#333'}; text-decoration: none; border-radius: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
        ${feed.title}
      </a>
      <button class="btn-delete-feed" data-feed-id="${feed.id}" style="background: none; border: none; color: #ff3b30; cursor: pointer; padding: 4px 8px;">✕</button>
    </div>
  `).join('');
  
  document.querySelectorAll('.feed-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      currentFeedId = e.target.dataset.feedId;
      renderApp();
    });
  });
  
  document.querySelectorAll('.btn-delete-feed').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const feedId = e.target.dataset.feedId;
      if (confirm('Delete this feed and all its articles?')) {
        await deleteFeed(feedId);
        if (currentFeedId === feedId) currentFeedId = null;
        renderApp();
      }
    });
  });
}

function renderArticles() {
  const container = document.getElementById('articles-list');
  const statusBar = document.getElementById('status-bar');
  
  const articles = currentFeedId ? getArticlesByFeed(currentFeedId) : getAllArticles();
  const feeds = getAllFeeds();
  const currentFeed = currentFeedId ? feeds.find(f => f.id === currentFeedId) : null;
  
  statusBar.textContent = currentFeed 
    ? `${currentFeed.title} — ${articles.length} articles`
    : `All Articles — ${articles.length} articles`;
  
  if (articles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #999;">
        <p style="font-size: 18px; margin-bottom: 8px;">No articles yet</p>
        <p style="font-size: 14px;">Add a feed and click "Refresh All Feeds" to fetch articles.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = articles.map(article => {
    const feed = feeds.find(f => f.id === article.feedId);
    return `
      <div class="article-item" data-article-id="${article.id}" 
        style="padding: 16px; border-bottom: 1px solid #eee; cursor: pointer; ${article.isRead ? 'opacity: 0.6;' : ''}">
        <div style="font-size: 16px; font-weight: ${article.isRead ? 'normal' : 'bold'}; margin-bottom: 4px;">
          ${article.title}
        </div>
        <div style="font-size: 12px; color: #666;">
          ${feed ? feed.title : 'Unknown'} 
          ${article.author ? '• ' + article.author : ''} 
          ${article.publishedAt ? '• ' + new Date(article.publishedAt).toLocaleDateString() : ''}
        </div>
        ${article.summary ? `<div style="font-size: 14px; color: #444; margin-top: 8px; line-height: 1.4;">${article.summary.substring(0, 200)}${article.summary.length > 200 ? '...' : ''}</div>` : ''}
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.article-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      const articleId = e.currentTarget.dataset.articleId;
      const article = articles.find(a => a.id === articleId);
      if (article) {
        await markArticleRead(articleId);
        window.open(article.url, '_blank');
        renderApp();
      }
    });
  });
}

async function handleAddFeed() {
  const input = document.getElementById('feed-url-input');
  const url = input.value.trim();
  
  if (!url) {
    alert('Please enter a feed URL');
    return;
  }
  
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Adding feed...';
  
  const feed = await addFeed(url);
  input.value = '';
  
  statusBar.textContent = 'Fetching articles...';
  const result = await refreshFeed(feed.id);
  
  if (result.success) {
    statusBar.textContent = `Added "${feed.title}" with ${result.newArticles} articles`;
  } else {
    statusBar.textContent = `Added feed but fetch failed: ${result.error}`;
  }
  
  renderApp();
}

async function handleRefreshAll() {
  const statusBar = document.getElementById('status-bar');
  const feeds = getAllFeeds();
  
  if (feeds.length === 0) {
    statusBar.textContent = 'No feeds to refresh. Add a feed first!';
    return;
  }
  
  statusBar.textContent = 'Refreshing all feeds...';
  
  const results = await refreshAllFeeds();
  const totalNew = results.reduce((sum, r) => sum + (r.newArticles || 0), 0);
  const failures = results.filter(r => !r.success).length;
  
  statusBar.textContent = `Refreshed ${results.length} feeds. ${totalNew} new articles.${failures > 0 ? ` ${failures} failed.` : ''}`;
  
  renderApp();
}

init();