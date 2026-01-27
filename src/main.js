// main.js - Fetch N Feed entry point

import { loadData, getData, exportData } from './database.js';
import { addFeed, getAllFeeds, getAllArticles, getArticlesByFeed, deleteFeed, markArticleRead, refreshFeed, refreshAllFeeds } from './feedManager.js';


let currentFeedId = null;
let currentSort = 'newest';
let selectedArticle = null;
let isLoadingArticle = false; // newest, oldest, feedAZ, feedZA, random
// Generate a consistent color for each feed
function getFeedColor(feedId) {
  const colors = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6', '#00c7be', '#ff2d55'];
  let hash = 0;
  for (let i = 0; i < feedId.length; i++) {
    hash = feedId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
async function init() {
  console.log('Fetch N Feed starting...');
  await loadData();
  renderApp();
}

// Strip HTML tags from content
function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

// Truncate text to a maximum length
function truncate(text, maxLength) {
  const clean = stripHtml(text).trim();
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength).trim() + '...';
}
// Format article content for display
function formatArticleContent(content) {
  if (!content) return '<p>No content available.</p>';
  
  // If content already looks like HTML, sanitize and return
  if (content.includes('<p>') || content.includes('<div>')) {
    return content;
  }
  
  // Convert plain text/markdown-style content to HTML
  return content
    .split('\n\n')
    .map(para => {
      para = para.trim();
      if (!para) return '';
      if (para.startsWith('## ')) {
        return `<h2 style="font-size: 20px; font-weight: 600; margin: 24px 0 12px 0;">${para.substring(3)}</h2>`;
      }
      if (para.startsWith('> ')) {
        return `<blockquote style="border-left: 3px solid #ddd; padding-left: 16px; margin: 16px 0; color: #555; font-style: italic;">${para.substring(2)}</blockquote>`;
      }
      if (para.startsWith('• ')) {
        return `<ul style="margin: 8px 0; padding-left: 20px;"><li>${para.substring(2)}</li></ul>`;
      }
      return `<p style="margin: 0 0 16px 0;">${para}</p>`;
    })
    .join('');
}
// Sort articles based on current sort mode
function sortArticles(articles, feeds) {
  const sorted = [...articles];
  
  switch (currentSort) {
    case 'newest':
      return sorted.sort((a, b) => {
        const dateA = a.publishedAt || a.fetchedAt;
        const dateB = b.publishedAt || b.fetchedAt;
        return dateB.localeCompare(dateA);
      });
    
    case 'oldest':
      return sorted.sort((a, b) => {
        const dateA = a.publishedAt || a.fetchedAt;
        const dateB = b.publishedAt || b.fetchedAt;
        return dateA.localeCompare(dateB);
      });
    
    case 'feedAZ':
      return sorted.sort((a, b) => {
        const feedA = feeds.find(f => f.id === a.feedId)?.title || '';
        const feedB = feeds.find(f => f.id === b.feedId)?.title || '';
        const feedCompare = feedA.localeCompare(feedB);
        if (feedCompare !== 0) return feedCompare;
        const dateA = a.publishedAt || a.fetchedAt;
        const dateB = b.publishedAt || b.fetchedAt;
        return dateB.localeCompare(dateA);
      });
    
    case 'feedZA':
      return sorted.sort((a, b) => {
        const feedA = feeds.find(f => f.id === a.feedId)?.title || '';
        const feedB = feeds.find(f => f.id === b.feedId)?.title || '';
        const feedCompare = feedB.localeCompare(feedA);
        if (feedCompare !== 0) return feedCompare;
        const dateA = a.publishedAt || a.fetchedAt;
        const dateB = b.publishedAt || b.fetchedAt;
        return dateB.localeCompare(dateA);
      });
    
    case 'random':
      for (let i = sorted.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      }
      return sorted;
    
    default:
      return sorted;
  }
}

function renderApp() {
  const app = document.querySelector('#app');
  if (!app) return;
  
  app.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; height: 100vh; background: #fafafa;">
      
      <!-- Sidebar -->
      <div style="width: 260px; background: #ffffff; padding: 16px; border-right: 1px solid #e0e0e0; overflow-y: auto; flex-shrink: 0;">
        <h2 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600; color: #1a1a1a;">Fetch N Feed</h2>
        
        <div style="margin-bottom: 20px;">
          <input type="text" id="feed-url-input" placeholder="Enter RSS feed URL..." 
            style="width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; margin-bottom: 8px; outline: none;"
            onfocus="this.style.borderColor='#007aff'" onblur="this.style.borderColor='#d0d0d0'">
          <button id="btn-add-feed" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 500; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">
            Add Feed
          </button>
        </div>
        
        <button id="btn-refresh-all" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 500; cursor: pointer; margin-bottom: 20px; background: #34c759; color: white; border: none; border-radius: 6px;">
          ↻ Refresh All Feeds
        </button>
        
        <div style="margin-bottom: 8px;">
          <a href="#" id="btn-all-articles" style="display: block; padding: 10px 12px; background: ${currentFeedId === null ? '#007aff' : 'transparent'}; color: ${currentFeedId === null ? 'white' : '#333'}; text-decoration: none; border-radius: 6px; font-weight: ${currentFeedId === null ? '500' : 'normal'};">
            📚 All Articles
          </a>
        </div>
        
        <div style="font-size: 11px; color: #888; margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Feeds</div>
        <div id="feeds-list"></div>
      </div>
      
      <!-- Main Content -->
      <div style="flex: 1; display: flex; overflow: hidden;">
        
        <!-- Articles List Panel -->
        <div style="width: ${selectedArticle ? '350px' : '100%'}; display: flex; flex-direction: column; overflow: hidden; background: #fafafa; border-right: ${selectedArticle ? '1px solid #e0e0e0' : 'none'}; transition: width 0.2s;">
          
          <!-- Header Bar -->
          <div style="padding: 12px 16px; background: #ffffff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <div id="status-bar" style="font-size: 14px; color: #666;"></div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <label style="font-size: 12px; color: #666;">Sort:</label>
              <select id="sort-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white; cursor: pointer;">
                <option value="newest" ${currentSort === 'newest' ? 'selected' : ''}>Newest</option>
                <option value="oldest" ${currentSort === 'oldest' ? 'selected' : ''}>Oldest</option>
                <option value="feedAZ" ${currentSort === 'feedAZ' ? 'selected' : ''}>Feed A→Z</option>
                <option value="feedZA" ${currentSort === 'feedZA' ? 'selected' : ''}>Feed Z→A</option>
                <option value="random" ${currentSort === 'random' ? 'selected' : ''}>Random</option>
              </select>
            </div>
          </div>
          
          <!-- Articles List -->
          <div id="articles-list" style="flex: 1; overflow-y: auto; padding: 12px;"></div>
        </div>
        
        <!-- Reading Pane -->
        ${selectedArticle ? `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #ffffff;">
          
         <!-- Reading Pane Header -->
          <div style="padding: 12px 20px; background: #f8f8f8; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-close-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 4px;">
              ← Back
            </button>
            <div style="display: flex; gap: 8px;">
              <button id="btn-share-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #34c759; color: white; border: none; border-radius: 4px;">
                📋 Share
              </button>
              <button id="btn-open-external" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 4px;">
                Open in Browser ↗
              </button>
            </div>
          </div>
          
          <!-- Article Content -->
          <div id="article-content" style="flex: 1; overflow-y: auto; padding: 24px 32px; max-width: 800px;">
            ${isLoadingArticle ? `
              <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 16px;">Loading full article...</p>
              </div>
            ` : `
              <h1 style="font-size: 28px; font-weight: 600; line-height: 1.3; margin: 0 0 16px 0; color: #1a1a1a;">
                ${stripHtml(selectedArticle.title)}
              </h1>
              <div style="font-size: 14px; color: #666; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee;">
                ${selectedArticle.author ? `<span>${stripHtml(selectedArticle.author)}</span> • ` : ''}
                ${selectedArticle.publishedAt ? new Date(selectedArticle.publishedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
              </div>
              <div style="font-size: 16px; line-height: 1.7; color: #333;">
                ${formatArticleContent(selectedArticle.content || selectedArticle.summary || 'No content available.')}
              </div>
            `}
          </div>
        </div>
        ` : ''}
      </div>
      
    </div>
  `;
  
 document.getElementById('btn-add-feed').addEventListener('click', handleAddFeed);
  document.getElementById('btn-refresh-all').addEventListener('click', handleRefreshAll);
  document.getElementById('btn-all-articles').addEventListener('click', (e) => {
    e.preventDefault();
    currentFeedId = null;
    selectedArticle = null;
    renderApp();
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderArticles();
  });
  
  // Reading pane buttons
  const closeBtn = document.getElementById('btn-close-article');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      selectedArticle = null;
      renderApp();
    });
  }
  
  const openExternalBtn = document.getElementById('btn-open-external');
  if (openExternalBtn) {
    openExternalBtn.addEventListener('click', () => {
      if (selectedArticle) {
        window.open(selectedArticle.url, '_blank');
      }
    });
  }
  
  const shareBtn = document.getElementById('btn-share-article');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (selectedArticle) {
        const shareText = `${stripHtml(selectedArticle.title)}\n${selectedArticle.url}`;
        try {
          await navigator.clipboard.writeText(shareText);
          shareBtn.textContent = '✓ Copied!';
          setTimeout(() => {
            shareBtn.textContent = '📋 Share';
          }, 2000);
        } catch (err) {
          console.error('Failed to copy:', err);
        }
      }
    });
  }
  renderFeedsList();
  renderArticles();
}

function renderFeedsList() {
  const container = document.getElementById('feeds-list');
  const feeds = getAllFeeds();
  
  if (feeds.length === 0) {
    container.innerHTML = '<div style="color: #999; font-size: 14px; padding: 8px 12px;">No feeds yet</div>';
    return;
  }
  
  container.innerHTML = feeds.map(feed => {
    const articleCount = getArticlesByFeed(feed.id).length;
    return `
      <div style="display: flex; align-items: center; margin-bottom: 2px;">
        <a href="#" class="feed-link" data-feed-id="${feed.id}" 
          style="flex: 1; padding: 10px 12px; background: ${currentFeedId === feed.id ? '#007aff' : 'transparent'}; color: ${currentFeedId === feed.id ? 'white' : '#333'}; text-decoration: none; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px;">
          ${feed.title} <span style="color: ${currentFeedId === feed.id ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">(${articleCount})</span>
        </a>
        <button class="btn-delete-feed" data-feed-id="${feed.id}" style="background: none; border: none; color: #ccc; cursor: pointer; padding: 4px 8px; font-size: 16px;" onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='#ccc'">×</button>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.feed-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      currentFeedId = e.target.closest('.feed-link').dataset.feedId;
      renderApp();
    });
  });
  
document.querySelectorAll('.btn-delete-feed').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      const feedId = this.getAttribute('data-feed-id');
      console.log('Delete clicked for feed:', feedId);
      if (feedId) {
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
  
  const feeds = getAllFeeds();
  let articles = currentFeedId ? getArticlesByFeed(currentFeedId) : getAllArticles();
  articles = sortArticles(articles, feeds);
  
  const currentFeed = currentFeedId ? feeds.find(f => f.id === currentFeedId) : null;
  
  statusBar.textContent = currentFeed 
    ? `${currentFeed.title} — ${articles.length} articles`
    : `All Articles — ${articles.length} articles`;
  
  if (articles.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: #999;">
        <div style="font-size: 48px; margin-bottom: 16px;">📭</div>
        <p style="font-size: 18px; margin-bottom: 8px; color: #666;">No articles yet</p>
        <p style="font-size: 14px;">Add a feed and click "Refresh All Feeds" to fetch articles.</p>
      </div>
    `;
    return;
  }
  
  // Track current feed for visual grouping
  let lastFeedId = null;
  const showFeedHeaders = (currentSort === 'feedAZ' || currentSort === 'feedZA') && !currentFeedId;
  
  let html = '';
  
  articles.forEach((article, index) => {
    const feed = feeds.find(f => f.id === article.feedId);
    const isEven = index % 2 === 0;
    
    // Add feed header when feed changes (for grouped sorts)
    if (showFeedHeaders && article.feedId !== lastFeedId) {
      html += `
        <div style="padding: 12px 16px; margin: ${lastFeedId ? '24px' : '0'} 0 12px 0; background: #e8e8e8; border-radius: 8px; font-weight: 600; color: #444; font-size: 14px;">
          📰 ${feed ? feed.title : 'Unknown Feed'}
        </div>
      `;
      lastFeedId = article.feedId;
    }
    
    const publishedDate = article.publishedAt 
      ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    
    html += `
      <div class="article-card" data-article-id="${article.id}" 
        style="background: ${isEven ? '#ffffff' : '#dceaff'}; border-left: 4px solid ${feed ? getFeedColor(feed.id) : '#ccc'}; border-radius: 8px; padding: 16px 20px; margin-bottom: 8px; border: 1px solid #e8e8e8; transition: all 0.15s ease; cursor: pointer; ${article.isRead ? 'opacity: 0.65;' : ''}"
        onmouseover="this.style.borderColor='#c0c0c0'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'"
        onmouseout="this.style.borderColor='#e8e8e8'; this.style.boxShadow='none'">
        
        <div style="font-size: 16px; font-weight: ${article.isRead ? '500' : '600'}; color: #1a1a1a; margin-bottom: 6px; line-height: 1.4;">
          ${stripHtml(article.title)}
        </div>
        
        <div style="font-size: 12px; color: #888; margin-bottom: 8px;">
          ${!showFeedHeaders && feed ? `<span style="color: #007aff;">${feed.title}</span> • ` : ''}${article.author ? stripHtml(article.author) + ' • ' : ''}${publishedDate}
        </div>
        
        ${article.summary ? `
          <div style="font-size: 14px; color: #555; line-height: 1.5;">
            ${truncate(article.summary, 220)}
          </div>
        ` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
  
    document.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      const articleId = e.currentTarget.dataset.articleId;
      const article = articles.find(a => a.id === articleId);
      if (article) {
        await markArticleRead(articleId);
        selectedArticle = article;
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
  
  renderArticles();
}

init();