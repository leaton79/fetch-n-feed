// main.js - Fetch N Feed entry point

import { loadData, getData, updateData, exportData } from './database.js';
import { addFeed, getAllFeeds, getAllArticles, getArticlesByFeed, deleteFeed, markArticleRead, toggleArticleStar, toggleArticleArchive, deleteArticle, deleteMultipleArticles, refreshFeed, refreshAllFeeds, addFolder, deleteFolder, getAllFolders, updateFeed, addNote, updateNote, deleteNote, deleteMultipleNotes, getAllNotes, getNotesByTag, getAllNoteTags, addNoteTag, deleteNoteTag, generateAPACitation, exportNotesToText, cleanupOldArticles } from './feedManager.js';
import { downloadOPML, parseOPML } from './opml.js';
import { state, ARTICLES_PER_PAGE } from './state.js';
import { getFeedColor, stripHtml, truncate, applyHighlight, formatArticleContent, sortArticles } from './utils.js';
import { showKeyboardHelp, showFolderDialog, showEditNoteDialog, showAddNoteDialog } from './views/dialogs.js';

// Extract full article content from a URL
async function extractArticle(url) {
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
  ];
  
  for (const proxyUrl of proxies) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(proxyUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Remove unwanted elements
      const removeSelectors = ['script', 'style', 'nav', 'header', 'footer', 'aside', '.sidebar', '.comments', '.ad', '.advertisement', 'iframe', 'noscript'];
      removeSelectors.forEach(sel => doc.querySelectorAll(sel).forEach(el => el.remove()));
      
      // Find main content
      const contentSelectors = ['article', '[role="main"]', 'main', '.post-content', '.article-content', '.entry-content', '.content', '.post-body'];
      let contentEl = null;
      for (const sel of contentSelectors) {
        contentEl = doc.querySelector(sel);
        if (contentEl && contentEl.textContent.trim().length > 200) break;
      }
      if (!contentEl) contentEl = doc.body;
      
      // Process images - make responsive and use absolute URLs
      contentEl.querySelectorAll('img').forEach(img => {
        let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src');
        if (src) {
          // Convert relative URLs to absolute
          if (src.startsWith('/')) {
            const urlObj = new URL(url);
            src = urlObj.origin + src;
          } else if (!src.startsWith('http')) {
            const urlObj = new URL(url);
            src = urlObj.origin + '/' + src;
          }
          img.setAttribute('src', src);
        }
        img.removeAttribute('width');
        img.removeAttribute('height');
        img.removeAttribute('style');
        img.setAttribute('style', 'max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; display: block;');
      });
      
      // Process links - make absolute and open in new tab
      contentEl.querySelectorAll('a').forEach(link => {
        let href = link.getAttribute('href');
        if (href) {
          if (href.startsWith('/')) {
            const urlObj = new URL(url);
            href = urlObj.origin + href;
          } else if (!href.startsWith('http') && !href.startsWith('#') && !href.startsWith('mailto:')) {
            const urlObj = new URL(url);
            href = urlObj.origin + '/' + href;
          }
          link.setAttribute('href', href);
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
          link.setAttribute('style', 'color: #007aff; text-decoration: underline;');
        }
      });
      
      // Extract content blocks preserving HTML
      const blocks = contentEl.querySelectorAll('p, h1, h2, h3, h4, li, blockquote, figure, img');
      let content = '';
      blocks.forEach(block => {
        const tag = block.tagName.toLowerCase();
        if (tag === 'img') {
          content += block.outerHTML;
        } else if (tag === 'figure') {
          content += block.outerHTML;
        } else if (block.textContent.trim().length > 20 || block.querySelector('img')) {
          if (tag.startsWith('h')) {
            content += `<h2 style="font-size: 20px; font-weight: 600; margin: 24px 0 12px 0;">${block.innerHTML}</h2>`;
          } else if (tag === 'blockquote') {
            content += `<blockquote style="border-left: 3px solid #ddd; padding-left: 16px; margin: 16px 0; color: #555; font-style: italic;">${block.innerHTML}</blockquote>`;
          } else if (tag === 'li') {
            content += `<p style="margin: 0 0 8px 0;">• ${block.innerHTML}</p>`;
          } else {
            content += `<p style="margin: 0 0 16px 0;">${block.innerHTML}</p>`;
          }
        }
      });
      
      if (content.length > 100) {
        return { success: true, content: content };
      }
      throw new Error('Content too short');
    } catch (error) {
      console.error('Extract failed:', error.message);
      continue;
    }
  }
  
  return { success: false, error: 'All proxies failed' };
}

// ── Targeted article-pane update ────────────────────────────────────────────
// Replaces the second full renderApp() call when an article finishes loading.
// Only updates #article-content, leaving the article list (and its scroll
// position) completely untouched.
function renderArticlePaneContent() {
  const contentDiv = document.getElementById('article-content');
  if (!contentDiv || !state.selectedArticle) return;

  if (state.isLoadingArticle) {
    contentDiv.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #666;">
        <p style="font-size: 16px;">Loading full article...</p>
      </div>
    `;
    return;
  }

  contentDiv.innerHTML = `
    <h1 style="font-size: 28px; font-weight: 600; line-height: 1.3; margin: 0 0 16px 0; color: #1a1a1a;">
      ${stripHtml(state.selectedArticle.title)}
    </h1>
    <div style="font-size: 14px; color: #666; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee;">
      ${state.selectedArticle.author ? `<span>${stripHtml(state.selectedArticle.author)}</span> · ` : ''}
      ${state.selectedArticle.publishedAt ? new Date(state.selectedArticle.publishedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
    </div>
    <div id="article-text" style="font-size: ${state.articleFontSize}px; line-height: 1.7; color: #333;">
      ${formatArticleContent(state.selectedArticle.content || state.selectedArticle.summary || 'No content available.', state.selectedArticle.id)}
    </div>
  `;
  // Always scroll the reading pane to top when new content arrives
  contentDiv.scrollTop = 0;
}

// ── Reading-position persistence ─────────────────────────────────────────────
// Saves the current feed + article selection to preferences so the next launch
// reopens to the same place. Only writes when something actually changed.
async function saveReadingPosition() {
  const data = getData();
  const prefs = data.preferences;
  const newFeedId = state.currentFeedId || null;
  const newArticleId = state.selectedArticle?.id || null;
  if (prefs.lastFeedId !== newFeedId || prefs.lastArticleId !== newArticleId) {
    await updateData({
      preferences: { ...prefs, lastFeedId: newFeedId, lastArticleId: newArticleId }
    });
  }
}

// Restores feed + article selection from the last session (called before renderApp).
function restoreReadingPosition() {
  const data = getData();
  const { lastFeedId, lastArticleId } = data.preferences;
  if (lastFeedId) {
    const feed = getAllFeeds().find(f => f.id === lastFeedId);
    if (feed) state.currentFeedId = lastFeedId;
  }
  if (lastArticleId) {
    const article = data.articles.find(a => a.id === lastArticleId);
    if (article) state.selectedArticle = article;
  }
}

// ── App initialisation ────────────────────────────────────────────────────────
async function init() {
  console.log('Fetch N Feed starting...');

  // Show a friendly loading screen immediately — replaces the blank white flash
  const app = document.querySelector('#app');
  if (app) {
    app.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center;
                  height: 100vh; background: #fafafa;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="text-align: center; color: #666;">
          <div style="font-size: 56px; margin-bottom: 16px;">📡</div>
          <h2 style="font-size: 22px; font-weight: 600; color: #1a1a1a; margin: 0 0 8px 0;">
            Fetch N Feed
          </h2>
          <p style="font-size: 14px; color: #888; margin: 0;">Loading your feeds…</p>
        </div>
      </div>
    `;
  }

  await loadData();

  // Clean up articles older than the retention window (keeps the DB lean).
  // Articles that are starred, highlighted, or have notes are always preserved.
  const cleaned = await cleanupOldArticles();
  if (cleaned > 0) console.log(`Startup cleanup: removed ${cleaned} old articles`);

  // Reopen to where the user left off
  restoreReadingPosition();

  renderApp();
  document.addEventListener('keydown', handleKeyboard);
}

function handleKeyboard(e) {
  // Don't trigger shortcuts when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }
  
  const feeds = getAllFeeds();
  const allArticles = getData().articles;
  let articles = state.currentFeedId 
    ? allArticles.filter(a => a.feedId === state.currentFeedId)
    : allArticles;
  
  // Apply current filter
  switch (state.currentFilter) {
    case 'unread': articles = articles.filter(a => !a.isRead); break;
    case 'starred': articles = articles.filter(a => a.isStarred); break;
    case 'archived': articles = articles.filter(a => a.isArchived); break;
    default: articles = articles.filter(a => !a.isArchived);
  }
  articles = sortArticles(articles, feeds, state.currentSort);
  
  const currentIndex = state.selectedArticle 
    ? articles.findIndex(a => a.id === state.selectedArticle.id) 
    : -1;
  
  switch (e.key) {
   case 'j':
      e.preventDefault();
      if (articles.length > 0) {
        const nextIndex = currentIndex < articles.length - 1 ? currentIndex + 1 : 0;
        selectArticle(articles[nextIndex]);
      }
      break;
      
    case 'k':
      e.preventDefault();
      if (articles.length > 0) {
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : articles.length - 1;
        selectArticle(articles[prevIndex]);
      }
      break;
    
    case 'ArrowDown':
      if (e.shiftKey) {
        e.preventDefault();
        if (articles.length > 0) {
          const nextIndex = currentIndex < articles.length - 1 ? currentIndex + 1 : 0;
          selectArticle(articles[nextIndex]);
        }
      }
      // Without shift, let arrow keys scroll naturally
      break;
      
    case 'ArrowUp':
      if (e.shiftKey) {
        e.preventDefault();
        if (articles.length > 0) {
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : articles.length - 1;
          selectArticle(articles[prevIndex]);
        }
      }
      // Without shift, let arrow keys scroll naturally
      break;
      
    case 'Enter':
    case 'o':
      if (state.selectedArticle) {
        e.preventDefault();
        window.open(state.selectedArticle.url, '_blank');
      }
      break;
      
    case 's':
      if (state.selectedArticle) {
        e.preventDefault();
        toggleArticleStar(state.selectedArticle.id).then(() => {
          state.selectedArticle = { ...state.selectedArticle, isStarred: !state.selectedArticle.isStarred };
          renderApp();
        });
      }
      break;
      
    case 'a':
      if (state.selectedArticle) {
        e.preventDefault();
        toggleArticleArchive(state.selectedArticle.id).then(() => {
          state.selectedArticle = { ...state.selectedArticle, isArchived: !state.selectedArticle.isArchived };
          renderApp();
        });
      }
      break;
      
    case 'Escape':
      if (state.selectedArticle) {
        e.preventDefault();
        state.selectedArticle = null;
        renderApp();
      }
      break;
      
    case 'r':
      if (e.metaKey || e.ctrlKey) {
        // Allow browser refresh
        return;
      }
      e.preventDefault();
      handleRefreshAll();
      break;
      
    case '?':
      e.preventDefault();
      showKeyboardHelp();
      break;
  }
}
async function selectArticle(article) {
  // Preserve the article list scroll position before the first renderApp() call
  const articleList = document.getElementById('articles-list');
  state.savedArticleListScroll = articleList ? articleList.scrollTop : 0;

  await markArticleRead(article.id);
  state.selectedArticle = article;
  state.isLoadingArticle = true;
  // First render: builds the 3-panel layout and shows the loading spinner
  renderApp();

  const textContent = stripHtml(article.content || '');
  const isTruncated = textContent.includes('Read the full story') ||
                      textContent.includes('Continue reading') ||
                      textContent.includes('Read more') ||
                      textContent.length < 500;
  if (!article.content || isTruncated) {
    const result = await extractArticle(article.url);
    if (result.success && result.content) {
      state.selectedArticle = { ...article, content: result.content };
    }
  }

  state.isLoadingArticle = false;
  // Targeted update: only swaps the article content div.
  // The article list DOM is never touched, so scroll position is preserved.
  renderArticlePaneContent();

  // Persist reading position for next launch
  saveReadingPosition();
}

function renderApp() {
  const app = document.querySelector('#app');
  if (!app) return;
  
  app.innerHTML = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; height: 100vh; background: #fafafa;">
      
      <div id="sidebar" style="width: ${state.sidebarWidth}px; background: #ffffff; padding: 16px; border-right: none; overflow-y: auto; flex-shrink: 0;">
        <h2 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 600; color: #1a1a1a;">Fetch N Feed</h2>
        
        <div style="margin-bottom: 20px;">
          <input type="text" id="feed-url-input" placeholder="Enter RSS feed URL..." 
            style="width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; margin-bottom: 8px; outline: none;">
          <button id="btn-add-feed" style="width: 100%; padding: 10px; font-size: 14px; font-weight: 500; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">
            Add Feed
          </button>
        </div>
        
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <button id="btn-refresh-all" style="flex: 1; padding: 10px; font-size: 14px; font-weight: 500; cursor: pointer; background: #34c759; color: white; border: none; border-radius: 6px;">
            ↻ Refresh
          </button>
          <select id="fetch-age-select" style="padding: 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 6px; background: white; cursor: pointer;">
            <option value="1" ${state.fetchAgeDays === 1 ? 'selected' : ''}>24 hours</option>
            <option value="7" ${state.fetchAgeDays === 7 ? 'selected' : ''}>7 days</option>
            <option value="14" ${state.fetchAgeDays === 14 ? 'selected' : ''}>2 weeks</option>
            <option value="30" ${state.fetchAgeDays === 30 ? 'selected' : ''}>1 month</option>
            <option value="90" ${state.fetchAgeDays === 90 ? 'selected' : ''}>3 months</option>
          </select>
        </div>
        
        <div style="display: flex; gap: 8px; margin-bottom: 20px;">
          <button id="btn-import-opml" style="flex: 1; padding: 8px; font-size: 12px; cursor: pointer; background: #e8e8e8; color: #333; border: none; border-radius: 6px;">
            📥 Import
          </button>
          <button id="btn-export-opml" style="flex: 1; padding: 8px; font-size: 12px; cursor: pointer; background: #e8e8e8; color: #333; border: none; border-radius: 6px;">
            📤 Export
          </button>
        </div>
        
        <input type="file" id="opml-file-input" accept=".opml,.xml" style="display: none;">
        
      ${(() => {
          const allArticles = getData().articles;
          const allCount = allArticles.filter(a => !a.isArchived).length;
          const unreadCount = allArticles.filter(a => !a.isRead && !a.isArchived).length;
          const starredCount = allArticles.filter(a => a.isStarred).length;
          const archivedCount = allArticles.filter(a => a.isArchived).length;
          return `
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-all-articles" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${state.currentFilter === 'all' && state.currentFeedId === null ? '#007aff' : 'transparent'}; color: ${state.currentFilter === 'all' && state.currentFeedId === null ? 'white' : '#333'}; text-decoration: none; border-radius: 6px; font-weight: ${state.currentFilter === 'all' ? '500' : 'normal'};">
                <span>📚 All Articles</span>
                <span style="color: ${state.currentFilter === 'all' && state.currentFeedId === null ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${allCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-unread" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${state.currentFilter === 'unread' ? '#007aff' : 'transparent'}; color: ${state.currentFilter === 'unread' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📩 Unread</span>
                <span style="color: ${state.currentFilter === 'unread' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${unreadCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-starred" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${state.currentFilter === 'starred' ? '#007aff' : 'transparent'}; color: ${state.currentFilter === 'starred' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>⭐ Starred</span>
                <span style="color: ${state.currentFilter === 'starred' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${starredCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 8px;">
              <a href="#" id="btn-archived" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${state.currentFilter === 'archived' ? '#007aff' : 'transparent'}; color: ${state.currentFilter === 'archived' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📦 Archived</span>
                <span style="color: ${state.currentFilter === 'archived' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${archivedCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-notes" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${state.showNotesView ? '#007aff' : 'transparent'}; color: ${state.showNotesView ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📝 Notes</span>
                <span style="color: ${state.showNotesView ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${(getData().notes || []).length}</span>
              </a>
            </div>
          `;
        })()}
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin: 16px 0 8px 0;">
          <span style="font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px;">Folders</span>
          <button id="btn-add-folder" style="background: none; border: none; color: #007aff; cursor: pointer; font-size: 16px; padding: 0 4px;" title="New Folder">+</button>
        </div>
        <div id="folders-list"></div>
        
        <div style="font-size: 11px; color: #888; margin: 16px 0 8px 0; text-transform: uppercase; letter-spacing: 0.5px;">Feeds</div>
        <input type="text" id="feed-search-input" placeholder="Filter feeds..." value="${state.feedSearchQuery}"
          style="width: 100%; padding: 6px 10px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box; margin-bottom: 8px; outline: none;">
        <div id="feeds-list"></div>
      </div>
      
      <div id="sidebar-resize" style="width: 5px; background: #e0e0e0; cursor: col-resize; flex-shrink: 0;" onmouseover="this.style.background='#007aff'" onmouseout="this.style.background='#e0e0e0'"></div>
      
      <div style="flex: 1; display: flex; overflow: hidden;">
        
        <div id="article-list-panel" style="width: ${state.selectedArticle && state.currentLayout !== 'inline' ? state.articleListWidth + 'px' : '100%'}; display: flex; flex-direction: column; overflow: hidden; background: #fafafa; flex-shrink: 0;">
          
          <div style="padding: 12px 16px; background: #ffffff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div id="status-bar" style="font-size: 14px; color: #666;"></div>
              <button id="btn-mark-all-read" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #e8e8e8; color: #555; border: none; border-radius: 4px; white-space: nowrap;">
                ✓ Mark All Read
              </button>
              ${state.selectedArticles.size > 0 ? `
              <span style="font-size: 11px; color: #666;">${state.selectedArticles.size} selected</span>
              <button id="btn-delete-selected" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #ff3b30; color: white; border: none; border-radius: 4px; white-space: nowrap;">
                🗑️ Delete Selected
              </button>
              <button id="btn-clear-selection" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #e8e8e8; color: #555; border: none; border-radius: 4px; white-space: nowrap;">
                ✕ Clear
              </button>
              ` : ''}
              <div style="position: relative;">
                <input type="text" id="search-input" placeholder="🔍 Search articles..." value="${state.searchQuery}" 
                  style="padding: 6px 12px; padding-right: 28px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; width: 180px; outline: none;">
                ${state.searchQuery ? `<button id="btn-clear-search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #999; padding: 0;">×</button>` : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <label style="font-size: 12px; color: #666;">View:</label>
                <select id="layout-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white; cursor: pointer;">
                  <option value="list" ${state.currentLayout === 'list' ? 'selected' : ''}>📋 List</option>
                  <option value="grid" ${state.currentLayout === 'grid' ? 'selected' : ''}>▦ Grid</option>
                  <option value="magazine" ${state.currentLayout === 'magazine' ? 'selected' : ''}>📰 Magazine</option>
                  <option value="inline" ${state.currentLayout === 'inline' ? 'selected' : ''}>📄 Inline</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
                <label style="font-size: 12px; color: #666;">Sort:</label>
                <select id="sort-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white; cursor: pointer;">
                  <option value="newest" ${state.currentSort === 'newest' ? 'selected' : ''}>Newest</option>
                  <option value="oldest" ${state.currentSort === 'oldest' ? 'selected' : ''}>Oldest</option>
                  <option value="feedAZ" ${state.currentSort === 'feedAZ' ? 'selected' : ''}>Feed A→Z</option>
                  <option value="feedZA" ${state.currentSort === 'feedZA' ? 'selected' : ''}>Feed Z→A</option>
                  <option value="random" ${state.currentSort === 'random' ? 'selected' : ''}>Random</option>
                </select>
              </div>
            </div>
          </div>
          
          <div id="articles-list" style="flex: 1; overflow-y: auto; padding: 12px;"></div>
        </div>
        
        ${state.selectedArticle && state.currentLayout !== 'inline' ? `<div id="articlelist-resize" style="width: 5px; background: #e0e0e0; cursor: col-resize; flex-shrink: 0;" onmouseover="this.style.background='#007aff'" onmouseout="this.style.background='#e0e0e0'"></div>` : ''}
        
        ${state.selectedArticle && state.currentLayout !== 'inline' ? `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #ffffff;">
          
          <div style="padding: 12px 20px; background: #f8f8f8; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-close-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 4px;">
              ← Back
            </button>
            <div style="display: flex; gap: 8px; align-items: center;">
              <div style="display: flex; align-items: center; gap: 4px; background: #e8e8e8; border-radius: 4px; padding: 2px;">
                <button id="btn-font-decrease" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A-</button>
                <span style="font-size: 12px; color: #666; min-width: 35px; text-align: center;">${state.articleFontSize}px</span>
                <button id="btn-font-increase" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A+</button>
              </div>
              <button id="btn-star-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${state.selectedArticle.isStarred ? '#ff9500' : '#e8e8e8'}; color: ${state.selectedArticle.isStarred ? 'white' : '#333'}; border: none; border-radius: 4px;">
                ${state.selectedArticle.isStarred ? '★ Starred' : '☆ Star'}
              </button>
              <button id="btn-archive-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${state.selectedArticle.isArchived ? '#8e8e93' : '#e8e8e8'}; color: ${state.selectedArticle.isArchived ? 'white' : '#333'}; border: none; border-radius: 4px;">
                ${state.selectedArticle.isArchived ? '📦 Archived' : '📥 Archive'}
              </button>
              <button id="btn-share-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #34c759; color: white; border: none; border-radius: 4px;">
                📋 Share
              </button>
              <button id="btn-open-external" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 4px;">
                Open in Browser ↗
              </button>
              <button id="btn-add-note" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #9c27b0; color: white; border: none; border-radius: 4px;">
                📝 Add Note
              </button>
              <button id="btn-delete-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #ff3b30; color: white; border: none; border-radius: 4px;">
                🗑️ Delete
              </button>
            </div>
          </div>
          
          <div id="article-content" style="flex: 1; overflow-y: auto; padding: 24px 32px;">
            ${state.isLoadingArticle ? `
              <div style="text-align: center; padding: 40px; color: #666;">
                <p style="font-size: 16px;">Loading full article...</p>
              </div>
            ` : `
              <h1 style="font-size: 28px; font-weight: 600; line-height: 1.3; margin: 0 0 16px 0; color: #1a1a1a;">
                ${stripHtml(state.selectedArticle.title)}
              </h1>
              <div style="font-size: 14px; color: #666; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #eee;">
                ${state.selectedArticle.author ? `<span>${stripHtml(state.selectedArticle.author)}</span> • ` : ''}
                ${state.selectedArticle.publishedAt ? new Date(state.selectedArticle.publishedAt).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : ''}
              </div>
              <div id="article-text" style="font-size: ${state.articleFontSize}px; line-height: 1.7; color: #333;">
                ${formatArticleContent(state.selectedArticle.content || state.selectedArticle.summary || 'No content available.', state.selectedArticle.id)}
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
  
  document.getElementById('btn-export-opml').addEventListener('click', () => {
    const feeds = getAllFeeds();
    if (feeds.length === 0) {
      alert('No feeds to export');
      return;
    }
    downloadOPML(feeds);
  });
  
  document.getElementById('btn-import-opml').addEventListener('click', () => {
    document.getElementById('opml-file-input').click();
  });
  
  document.getElementById('opml-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusBar = document.getElementById('status-bar');
    statusBar.textContent = 'Importing feeds...';
    
    try {
      const text = await file.text();
      const feedsToImport = parseOPML(text);
      
      if (feedsToImport.length === 0) {
        statusBar.textContent = 'No feeds found in OPML file';
        return;
      }
      
      const existingUrls = new Set(getAllFeeds().map(f => f.url));
      let imported = 0;
      let skipped = 0;
      
      for (const feed of feedsToImport) {
        if (existingUrls.has(feed.url)) {
          skipped++;
        } else {
          await addFeed(feed.url, feed.title);
          imported++;
        }
      }
      
      statusBar.textContent = `Imported ${imported} feeds${skipped > 0 ? `, ${skipped} already existed` : ''}. Fetching articles...`;
      renderApp();
      
      // Auto-refresh to fetch articles
      if (imported > 0) {
        const results = await refreshAllFeeds();
        const totalNew = results.reduce((sum, r) => sum + (r.newArticles || 0), 0);
        statusBar.textContent = `Imported ${imported} feeds with ${totalNew} articles${skipped > 0 ? `, ${skipped} already existed` : ''}`;
        renderArticles();
      }
    } catch (err) {
      console.error('OPML import error:', err);
      statusBar.textContent = 'Error importing OPML: ' + err.message;
    }
    
    // Reset file input
    e.target.value = '';
  });
  document.getElementById('btn-add-folder').addEventListener('click', () => {
    showFolderDialog(renderApp);
  });
  document.getElementById('btn-all-articles').addEventListener('click', (e) => {
    e.preventDefault();
    state.showNotesView = false;
    state.currentFeedId = null;
    state.currentFilter = 'all';
    state.selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-unread').addEventListener('click', (e) => {
    e.preventDefault();
    state.showNotesView = false;
    state.currentFeedId = null;
    state.currentFilter = 'unread';
    state.selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-starred').addEventListener('click', (e) => {
    e.preventDefault();
    state.showNotesView = false;
    state.currentFeedId = null;
    state.currentFilter = 'starred';
    state.selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-archived').addEventListener('click', (e) => {
    e.preventDefault();
    state.showNotesView = false;
    state.currentFeedId = null;
    state.currentFilter = 'archived';
    state.selectedArticle = null;
    renderApp();
  });
  document.getElementById('btn-notes').addEventListener('click', (e) => {
    e.preventDefault();
    state.showNotesView = true;
    state.currentFeedId = null;
    state.currentFolderId = null;
    state.selectedArticle = null;
    renderApp();
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    state.currentSort = e.target.value;
    renderArticles();
  });
  document.getElementById('layout-select').addEventListener('change', (e) => {
    state.currentLayout = e.target.value;
    state.selectedArticle = null;
    renderArticles();
  });
  document.getElementById('feed-search-input').addEventListener('input', (e) => {
    state.feedSearchQuery = e.target.value;
    renderFeedsList();
  });
  document.getElementById('fetch-age-select').addEventListener('change', (e) => {
    state.fetchAgeDays = parseInt(e.target.value) || 7;
    renderArticles();
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderArticles();
  });
  
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.searchQuery = '';
      e.target.value = '';
      renderArticles();
    }
  });
  
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      document.getElementById('search-input').value = '';
      renderArticles();
    });
  }
  document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
    const feeds = getAllFeeds();
    const data = getData();
    const allArticlesRaw = data.articles;
    let articlesToMark;
    
    if (state.currentFeedId) {
      articlesToMark = allArticlesRaw.filter(a => a.feedId === state.currentFeedId);
    } else if (state.currentFolderId) {
      const folderFeeds = feeds.filter(f => f.folderIds && f.folderIds.includes(state.currentFolderId));
      const folderFeedIds = new Set(folderFeeds.map(f => f.id));
      articlesToMark = allArticlesRaw.filter(a => folderFeedIds.has(a.feedId));
    } else {
      articlesToMark = allArticlesRaw;
    }
    
    // Apply current filter
    switch (state.currentFilter) {
      case 'unread': articlesToMark = articlesToMark.filter(a => !a.isRead); break;
      case 'starred': articlesToMark = articlesToMark.filter(a => a.isStarred); break;
      case 'archived': articlesToMark = articlesToMark.filter(a => a.isArchived); break;
      default: articlesToMark = articlesToMark.filter(a => !a.isArchived);
    }
    
    // Batch update - mark all as read in one operation
    const idsToMark = new Set(articlesToMark.filter(a => !a.isRead).map(a => a.id));
    if (idsToMark.size === 0) return;
    
    const timestamp = new Date().toISOString();
    const updatedArticles = allArticlesRaw.map(a => 
      idsToMark.has(a.id) ? { ...a, isRead: true, readAt: timestamp } : a
    );
    
    await updateData({ articles: updatedArticles });
    renderArticles();
  });
  const deleteSelectedBtn = document.getElementById('btn-delete-selected');
  if (deleteSelectedBtn) {
    deleteSelectedBtn.addEventListener('click', async () => {
      if (state.selectedArticles.size === 0) return;
      await deleteMultipleArticles(Array.from(state.selectedArticles));
      state.selectedArticles.clear();
      state.selectedArticle = null;
      renderApp();
    });
  }
  
  const clearSelectionBtn = document.getElementById('btn-clear-selection');
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      state.selectedArticles.clear();
      renderArticles();
    });
  }
  const closeBtn = document.getElementById('btn-close-article');
  if (closeBtn) closeBtn.addEventListener('click', () => { state.selectedArticle = null; renderApp(); });
  
  const openExternalBtn = document.getElementById('btn-open-external');
  if (openExternalBtn) openExternalBtn.addEventListener('click', () => { if (state.selectedArticle) window.open(state.selectedArticle.url, '_blank'); });
  
  const starBtn = document.getElementById('btn-star-article');
  if (starBtn) {
    starBtn.addEventListener('click', async () => {
      if (state.selectedArticle) {
        await toggleArticleStar(state.selectedArticle.id);
        state.selectedArticle = { ...state.selectedArticle, isStarred: !state.selectedArticle.isStarred };
        renderApp();
      }
    });
  }
  
  const archiveBtn = document.getElementById('btn-archive-article');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      if (state.selectedArticle) {
        await toggleArticleArchive(state.selectedArticle.id);
        state.selectedArticle = { ...state.selectedArticle, isArchived: !state.selectedArticle.isArchived };
        renderApp();
      }
    });
  }
  
  const addNoteBtn = document.getElementById('btn-add-note');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      if (state.selectedArticle) {
        const selection = window.getSelection();
        const highlightedText = selection.toString().trim();
        showAddNoteDialog(state.selectedArticle, highlightedText, renderApp);
      }
    });
  }
  const deleteArticleBtn = document.getElementById('btn-delete-article');
  if (deleteArticleBtn) {
    deleteArticleBtn.addEventListener('click', async () => {
      if (!state.selectedArticle) return;
      await deleteArticle(state.selectedArticle.id);
      state.selectedArticle = null;
      renderApp();
    });
  }
  const sidebarResize = document.getElementById('sidebar-resize');
  if (sidebarResize) {
    sidebarResize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = state.sidebarWidth;
      const onMouseMove = (e) => {
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth >= 150 && newWidth <= 500) {
          state.sidebarWidth = newWidth;
          document.getElementById('sidebar').style.width = newWidth + 'px';
        }
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
  
  const fontDecreaseBtn = document.getElementById('btn-font-decrease');
  if (fontDecreaseBtn) {
    fontDecreaseBtn.addEventListener('click', () => {
      if (state.articleFontSize > 12) {
        state.articleFontSize -= 2;
        const textEl = document.getElementById('article-text');
        if (textEl) textEl.style.fontSize = state.articleFontSize + 'px';
        fontDecreaseBtn.nextElementSibling.textContent = state.articleFontSize + 'px';
      }
    });
  }
  
  const fontIncreaseBtn = document.getElementById('btn-font-increase');
  if (fontIncreaseBtn) {
    fontIncreaseBtn.addEventListener('click', () => {
      if (state.articleFontSize < 28) {
        state.articleFontSize += 2;
        const textEl = document.getElementById('article-text');
        if (textEl) textEl.style.fontSize = state.articleFontSize + 'px';
        fontIncreaseBtn.previousElementSibling.textContent = state.articleFontSize + 'px';
      }
    });
  }
  
  const articleListResize = document.getElementById('articlelist-resize');
  if (articleListResize) {
    articleListResize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = state.articleListWidth;
      const onMouseMove = (e) => {
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth >= 250 && newWidth <= 600) {
          state.articleListWidth = newWidth;
          document.getElementById('article-list-panel').style.width = newWidth + 'px';
        }
      };
      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
  function renderFoldersList() {
  const container = document.getElementById('folders-list');
  const folders = getAllFolders();
  let feeds = getAllFeeds();
  const allArticles = getData().articles;
  
  if (folders.length === 0) {
    container.innerHTML = '<div style="color: #999; font-size: 12px; padding: 4px 12px; font-style: italic;">No folders yet</div>';
    return;
  }
  
  container.innerHTML = folders.map(folder => {
    const folderFeeds = feeds.filter(f => f.folderIds && f.folderIds.includes(folder.id));
    const isExpanded = state.expandedFolders.has(folder.id);
    const isSelected = state.currentFolderId === folder.id;
    
    // Count articles in folder
    const folderArticleCount = folderFeeds.reduce((sum, feed) => {
      return sum + allArticles.filter(a => a.feedId === feed.id && !a.isArchived).length;
    }, 0);
    
    let html = `
      <div style="margin-bottom: 2px;">
        <div class="folder-header" data-folder-id="${folder.id}" 
          style="display: flex; align-items: center; padding: 8px 12px; background: ${isSelected ? '#007aff' : 'transparent'}; color: ${isSelected ? 'white' : '#333'}; border-radius: 6px; cursor: pointer;"
          onmouseover="this.style.background='${isSelected ? '#007aff' : '#f0f0f0'}'" 
          onmouseout="this.style.background='${isSelected ? '#007aff' : 'transparent'}'">
          <span style="margin-right: 8px; font-size: 12px;">${isExpanded ? '▼' : '▶'}</span>
          <span style="flex: 1; font-size: 14px;">📁 ${folder.name}</span>
          <span style="color: ${isSelected ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px; margin-right: 8px;">${folderArticleCount}</span>
          <button class="btn-delete-folder" data-folder-id="${folder.id}" 
            style="background: none; border: none; color: ${isSelected ? 'rgba(255,255,255,0.7)' : '#ccc'}; cursor: pointer; padding: 0 4px; font-size: 14px;"
            onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='${isSelected ? 'rgba(255,255,255,0.7)' : '#ccc'}'">×</button>
        </div>
    `;
    
    if (isExpanded && folderFeeds.length > 0) {
      html += '<div style="margin-left: 20px;">';
      folderFeeds.forEach(feed => {
        const articleCount = allArticles.filter(a => a.feedId === feed.id && !a.isArchived).length;
        html += `
          <div style="display: flex; align-items: center; margin-bottom: 2px;">
            <a href="#" class="feed-link" data-feed-id="${feed.id}" 
              style="flex: 1; padding: 6px 12px; background: ${state.currentFeedId === feed.id ? '#007aff' : 'transparent'}; color: ${state.currentFeedId === feed.id ? 'white' : '#555'}; text-decoration: none; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${feed.title} <span style="color: ${state.currentFeedId === feed.id ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 11px;">(${articleCount})</span>
            </a>
            <button class="btn-remove-from-folder" data-feed-id="${feed.id}" data-folder-id="${folder.id}"
              style="background: none; border: none; color: #ccc; cursor: pointer; padding: 2px 6px; font-size: 12px;"
              onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='#ccc'" title="Remove from folder">×</button>
          </div>
        `;
      });
      html += '</div>';
    } else if (isExpanded) {
      html += '<div style="margin-left: 20px; padding: 6px 12px; color: #999; font-size: 12px; font-style: italic;">No feeds in folder</div>';
    }
    
    html += '</div>';
    return html;
  }).join('');
  
  // Event listeners for folders
  document.querySelectorAll('.folder-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-delete-folder')) return;
      
      const folderId = header.dataset.folderId;
      
      if (e.target.tagName === 'SPAN' && e.target.textContent.match(/[▼▶]/)) {
        // Toggle expand/collapse
        if (state.expandedFolders.has(folderId)) {
          state.expandedFolders.delete(folderId);
        } else {
          state.expandedFolders.add(folderId);
        }
        renderFoldersList();
      } else {
        // Select folder to view its articles
        state.currentFolderId = state.currentFolderId === folderId ? null : folderId;
        state.currentFeedId = null;
        state.currentFilter = 'all';
        state.selectedArticle = null;
        renderApp();
      }
    });
  });
  
  document.querySelectorAll('.btn-delete-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      await deleteFolder(folderId);
      if (state.currentFolderId === folderId) state.currentFolderId = null;
      renderApp();
    });
  });
  
  document.querySelectorAll('.btn-remove-from-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const feedId = btn.dataset.feedId;
      const folderId = btn.dataset.folderId;
      const feed = getAllFeeds().find(f => f.id === feedId);
      if (feed) {
        const newFolderIds = (feed.folderIds || []).filter(id => id !== folderId);
        await updateFeed(feedId, { folderIds: newFolderIds });
        renderApp();
      }
    });
  });
  
  // Feed links inside folders
  document.querySelectorAll('#folders-list .feed-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      state.currentFeedId = link.dataset.feedId;
      state.currentFolderId = null;
      state.currentFilter = 'all';
      state.selectedArticle = null;
      renderApp();
    });
  });
}
  renderFoldersList();
  renderFeedsList();
  renderArticles();
}

function renderFeedsList() {
  const container = document.getElementById('feeds-list');
  let feeds = getAllFeeds();
  const folders = getAllFolders();
  const allArticles = getData().articles;
  // Filter feeds by search query
  if (state.feedSearchQuery && state.feedSearchQuery.trim()) {
    const query = state.feedSearchQuery.toLowerCase().trim();
    feeds = feeds.filter(f => f.title.toLowerCase().includes(query));
  }
  if (feeds.length === 0) {
    container.innerHTML = '<div style="color: #999; font-size: 14px; padding: 8px 12px;">No feeds yet</div>';
    return;
  }
  
  container.innerHTML = feeds.map(feed => {
    const articleCount = allArticles.filter(a => a.feedId === feed.id && !a.isArchived).length;
    const unreadCount = allArticles.filter(a => a.feedId === feed.id && !a.isRead && !a.isArchived).length;
    const isActive = state.currentFeedId === feed.id;

    // Badge: blue pill when there are unread items; subtle grey when all read
    const badge = unreadCount > 0
      ? `<span style="
            background: ${isActive ? 'rgba(255,255,255,0.30)' : '#007aff'};
            color: white; font-size: 11px; font-weight: 700;
            padding: 1px 7px; border-radius: 10px; margin-left: 6px;
            flex-shrink: 0;">${unreadCount}</span>`
      : `<span style="color: ${isActive ? 'rgba(255,255,255,0.5)' : '#ccc'};
                      font-size: 11px; margin-left: 6px; flex-shrink: 0;">
            ${articleCount}</span>`;

    return `
      <div style="display: flex; align-items: center; margin-bottom: 2px;">
        <a href="#" class="feed-link" data-feed-id="${feed.id}"
          style="flex: 1; display: flex; align-items: center;
                 padding: 10px 12px;
                 background: ${isActive ? '#007aff' : 'transparent'};
                 color: ${isActive ? 'white' : '#333'};
                 text-decoration: none; border-radius: 6px; font-size: 14px;
                 overflow: hidden; min-width: 0;">
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                       font-weight: ${unreadCount > 0 ? '600' : 'normal'};">
            ${feed.title}
          </span>
          ${badge}
        </a>
        <button class="btn-feed-menu" data-feed-id="${feed.id}" style="background: none; border: none; color: #ccc; cursor: pointer; padding: 4px 6px; font-size: 14px;" onmouseover="this.style.color='#007aff'" onmouseout="this.style.color='#ccc'" title="Add to folder">📁</button>
        <button class="btn-delete-feed" data-feed-id="${feed.id}" style="background: none; border: none; color: #ccc; cursor: pointer; padding: 4px 8px; font-size: 16px;" onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='#ccc'">×</button>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.feed-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      state.currentFeedId = e.target.closest('.feed-link').dataset.feedId;
      state.currentFolderId = null;
      state.currentFilter = 'all';
      state.selectedArticle = null;
      renderApp();
    });
  });
  
  document.querySelectorAll('.btn-delete-feed').forEach(btn => {
    btn.addEventListener('click', async function(e) {
      e.preventDefault();
      e.stopPropagation();
      const feedId = this.getAttribute('data-feed-id');
      if (feedId) {
        await deleteFeed(feedId);
        if (state.currentFeedId === feedId) state.currentFeedId = null;
        renderApp();
      }
    });
  });
  
  document.querySelectorAll('.btn-feed-menu').forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const feedId = this.getAttribute('data-feed-id');
      const feed = feeds.find(f => f.id === feedId);
      
      // Remove any existing menu
      const existingMenu = document.getElementById('folder-menu');
      if (existingMenu) existingMenu.remove();
      
      if (folders.length === 0) {
        alert('Create a folder first');
        return;
      }
      
      // Create menu
      const rect = this.getBoundingClientRect();
      const menu = document.createElement('div');
      menu.id = 'folder-menu';
      menu.style.cssText = `position: fixed; top: ${rect.bottom + 4}px; left: ${rect.left - 100}px; background: white; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); padding: 8px 0; z-index: 1000; min-width: 150px;`;
      
      menu.innerHTML = folders.map(folder => {
        const isInFolder = feed.folderIds && feed.folderIds.includes(folder.id);
        return `
          <div class="folder-menu-item" data-folder-id="${folder.id}" data-feed-id="${feedId}"
            style="padding: 8px 16px; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 8px;"
            onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='transparent'">
            <span style="width: 16px;">${isInFolder ? '✓' : ''}</span>
            <span>📁 ${folder.name}</span>
          </div>
        `;
      }).join('');
      
      document.body.appendChild(menu);
      
      // Handle folder selection
      menu.querySelectorAll('.folder-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
          const folderId = item.dataset.folderId;
          const feedId = item.dataset.feedId;
          const feed = getAllFeeds().find(f => f.id === feedId);
          
          let newFolderIds = feed.folderIds || [];
          if (newFolderIds.includes(folderId)) {
            newFolderIds = newFolderIds.filter(id => id !== folderId);
          } else {
            newFolderIds = [...newFolderIds, folderId];
          }
          
          await updateFeed(feedId, { folderIds: newFolderIds });
          menu.remove();
          renderApp();
        });
      });
      
      // Close menu on outside click
      setTimeout(() => {
        document.addEventListener('click', function closeMenu(e) {
          if (!menu.contains(e.target)) {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          }
        });
      }, 0);
    });
  });
}

function renderArticles() {
  const container = document.getElementById('articles-list');
  const statusBar = document.getElementById('status-bar');
  
  // Show notes view if active
  if (state.showNotesView) {
    renderNotesView();
    return;
  }
  
  const feeds = getAllFeeds();
  
  // Get all articles (we'll filter ourselves)
  const allArticlesRaw = getData().articles;
  let articles;
  
  if (state.currentFeedId) {
    articles = allArticlesRaw.filter(a => a.feedId === state.currentFeedId);
  } else if (state.currentFolderId) {
    const folderFeeds = feeds.filter(f => f.folderIds && f.folderIds.includes(state.currentFolderId));
    const folderFeedIds = new Set(folderFeeds.map(f => f.id));
    articles = allArticlesRaw.filter(a => folderFeedIds.has(a.feedId));
  } else {
    articles = allArticlesRaw;
  }
  
  // Apply filter
  switch (state.currentFilter) {
    case 'unread':
      articles = articles.filter(a => !a.isRead);
      break;
    case 'starred':
      articles = articles.filter(a => a.isStarred);
      break;
    case 'archived':
      articles = articles.filter(a => a.isArchived);
      break;
    default:
      articles = articles.filter(a => !a.isArchived);
  }
  
  // Apply time filter
  const fetchAgeSelect = document.getElementById('fetch-age-select');
  if (fetchAgeSelect) {
    const maxAgeDays = parseInt(fetchAgeSelect.value) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
    const cutoffString = cutoffDate.toISOString();
    articles = articles.filter(a => (a.publishedAt || a.fetchedAt) >= cutoffString);
  }
  
  // Apply search filter
  if (state.searchQuery && state.searchQuery.trim()) {
    const query = state.searchQuery.toLowerCase().trim();
    articles = articles.filter(a => {
      const title = (a.title || '').toLowerCase();
      const summary = (a.summary || '').toLowerCase();
      const content = (a.content || '').toLowerCase();
      const author = (a.author || '').toLowerCase();
      const feed = feeds.find(f => f.id === a.feedId);
      const feedTitle = (feed?.title || '').toLowerCase();
      
      return title.includes(query) || 
             summary.includes(query) || 
             content.includes(query) || 
             author.includes(query) ||
             feedTitle.includes(query);
    });
  }
  
  articles = sortArticles(articles, feeds, state.currentSort);
  
  const currentFeed = state.currentFeedId ? feeds.find(f => f.id === state.currentFeedId) : null;
  statusBar.textContent = currentFeed ? `${currentFeed.title} — ${articles.length} articles` : `All Articles — ${articles.length} articles`;
  
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
  
  // Reset to page 1 whenever the feed/filter/search context changes
  const newContext = `${state.currentFeedId}|${state.currentFolderId}|${state.currentFilter}|${state.searchQuery}`;
  if (newContext !== state.lastArticlesContext) {
    state.articlesPage = 1;
    state.lastArticlesContext = newContext;
  }

  // Paginate: show ARTICLES_PER_PAGE at a time
  const pagedArticles = articles.slice(0, state.articlesPage * ARTICLES_PER_PAGE);
  const hasMore = articles.length > pagedArticles.length;
  const remaining = articles.length - pagedArticles.length;

  switch (state.currentLayout) {
    case 'grid': renderGridLayout(container, pagedArticles, feeds); break;
    case 'magazine': renderMagazineLayout(container, pagedArticles, feeds); break;
    case 'inline': renderInlineLayout(container, pagedArticles, feeds); break;
    default: renderListLayout(container, pagedArticles, feeds);
  }

  // Append "Load more" button when there are hidden articles
  if (hasMore) {
    const loadMoreDiv = document.createElement('div');
    loadMoreDiv.style.cssText = 'text-align: center; padding: 20px 0 32px 0;';
    loadMoreDiv.innerHTML = `
      <button type="button" id="btn-load-more"
        style="padding: 10px 28px; font-size: 14px; cursor: pointer;
               background: #e8e8e8; color: #333; border: none; border-radius: 6px;
               font-weight: 500;">
        Load more <span style="color:#888; font-weight:400;">(${remaining} remaining)</span>
      </button>
    `;
    container.appendChild(loadMoreDiv);
    document.getElementById('btn-load-more').addEventListener('click', () => {
      state.articlesPage++;
      // Save scroll position so "Load more" doesn't jump
      const list = document.getElementById('articles-list');
      state.savedArticleListScroll = list ? list.scrollTop : 0;
      renderArticles();
    });
  }

  // Restore scroll position if saved (e.g. after article selection)
  if (state.savedArticleListScroll > 0) {
    const articlesList = document.getElementById('articles-list');
    if (articlesList) articlesList.scrollTop = state.savedArticleListScroll;
  }
}

function renderListLayout(container, articles, feeds) {
  let lastFeedId = null;
  const showFeedHeaders = (state.currentSort === 'feedAZ' || state.currentSort === 'feedZA') && !state.currentFeedId;
  let html = '';
  
  articles.forEach((article, index) => {
    const feed = feeds.find(f => f.id === article.feedId);
    const isEven = index % 2 === 0;
    
    if (showFeedHeaders && article.feedId !== lastFeedId) {
      html += `<div style="padding: 12px 16px; margin: ${lastFeedId ? '24px' : '0'} 0 12px 0; background: #e8e8e8; border-radius: 8px; font-weight: 600; color: #444; font-size: 14px;">📰 ${feed ? feed.title : 'Unknown Feed'}</div>`;
      lastFeedId = article.feedId;
    }
    
    const publishedDate = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    
    html += `
      <div class="article-card" data-article-id="${article.id}" 
        style="background: ${state.selectedArticles.has(article.id) ? '#fff3cd' : (isEven ? '#ffffff' : '#dceaff')}; border-left: 4px solid ${feed ? getFeedColor(feed.id) : '#ccc'}; border-radius: 8px; padding: 16px 20px; margin-bottom: 8px; border: 2px solid ${state.selectedArticles.has(article.id) ? '#ff9500' : '#e8e8e8'}; cursor: pointer; ${article.isRead ? 'opacity: 0.65;' : ''}"
        onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.06)'" onmouseout="this.style.boxShadow='none'">
        <div style="font-size: 16px; font-weight: ${article.isRead ? '500' : '600'}; color: #1a1a1a; margin-bottom: 6px; line-height: 1.4;">${stripHtml(article.title)}</div>
        <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${!showFeedHeaders && feed ? `<span style="color: #007aff;">${feed.title}</span> • ` : ''}${article.author ? stripHtml(article.author) + ' • ' : ''}${publishedDate}</div>
        ${article.summary ? `<div style="font-size: 14px; color: #555; line-height: 1.5;">${truncate(article.summary, 220)}</div>` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
  attachArticleClickHandlers(articles);
}

function renderGridLayout(container, articles, feeds) {
  let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">';
  
  articles.forEach((article) => {
    const feed = feeds.find(f => f.id === article.feedId);
    const publishedDate = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    const imgMatch = (article.content || '').match(/<img[^>]+src=["']([^"']+)["']/i);
    const imageUrl = imgMatch ? imgMatch[1] : null;
    
    html += `
      <div class="article-card" data-article-id="${article.id}" 
        style="background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8; cursor: pointer; display: flex; flex-direction: column; ${article.isRead ? 'opacity: 0.65;' : ''}"
        onmouseover="this.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'" onmouseout="this.style.boxShadow='none'">
        ${imageUrl ? `<div style="width: 100%; height: 160px; background: url('${imageUrl}') center/cover no-repeat; background-color: #f0f0f0;"></div>` : `<div style="width: 100%; height: 80px; background: linear-gradient(135deg, ${feed ? getFeedColor(feed.id) : '#ccc'}22, ${feed ? getFeedColor(feed.id) : '#ccc'}44);"></div>`}
        <div style="padding: 16px; flex: 1; display: flex; flex-direction: column;">
          <div style="font-size: 15px; font-weight: ${article.isRead ? '500' : '600'}; color: #1a1a1a; margin-bottom: 8px; line-height: 1.4;">${stripHtml(article.title)}</div>
          <div style="font-size: 12px; color: #888; margin-top: auto;"><span style="color: ${feed ? getFeedColor(feed.id) : '#888'};">${feed ? feed.title : 'Unknown'}</span> • ${publishedDate}</div>
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
  attachArticleClickHandlers(articles);
}

function renderMagazineLayout(container, articles, feeds) {
  if (articles.length === 0) return;
  
  // Limit to 50 articles for performance
  const limitedArticles = articles.slice(0, 50);
  const featured = limitedArticles[0];
  const rest = limitedArticles.slice(1);
  const featuredFeed = feeds.find(f => f.id === featured.feedId);
  const featuredImgMatch = (featured.content || '').match(/<img[^>]+src=["']([^"']+)["']/i);
  const featuredImage = featuredImgMatch ? featuredImgMatch[1] : null;
  const featuredDate = featured.publishedAt ? new Date(featured.publishedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  
  let html = `
    <div class="article-card" data-article-id="${featured.id}" 
      style="background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e8e8e8; margin-bottom: 24px; cursor: pointer; ${featured.isRead ? 'opacity: 0.65;' : ''}"
      onmouseover="this.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'" onmouseout="this.style.boxShadow='none'">
      ${featuredImage ? `<div style="width: 100%; height: 300px; background: url('${featuredImage}') center/cover no-repeat; background-color: #f0f0f0;"></div>` : `<div style="width: 100%; height: 200px; background: linear-gradient(135deg, ${featuredFeed ? getFeedColor(featuredFeed.id) : '#ccc'}33, ${featuredFeed ? getFeedColor(featuredFeed.id) : '#ccc'}66);"></div>`}
      <div style="padding: 24px;">
        <div style="font-size: 24px; font-weight: 700; color: #1a1a1a; margin-bottom: 12px; line-height: 1.3;">${stripHtml(featured.title)}</div>
        ${featured.summary ? `<div style="font-size: 16px; color: #555; line-height: 1.6; margin-bottom: 16px;">${truncate(featured.summary, 300)}</div>` : ''}
        <div style="font-size: 13px; color: #888;"><span style="color: ${featuredFeed ? getFeedColor(featuredFeed.id) : '#888'};">${featuredFeed ? featuredFeed.title : 'Unknown'}</span>${featured.author ? ' • ' + stripHtml(featured.author) : ''} • ${featuredDate}</div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
  `;
  
  rest.forEach((article) => {
    const feed = feeds.find(f => f.id === article.feedId);
    const publishedDate = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    html += `
      <div class="article-card" data-article-id="${article.id}" 
        style="background: #ffffff; border-radius: 8px; padding: 16px; border: 1px solid #e8e8e8; cursor: pointer; ${article.isRead ? 'opacity: 0.65;' : ''}"
        onmouseover="this.style.borderColor='#c0c0c0'" onmouseout="this.style.borderColor='#e8e8e8'">
        <div style="font-size: 15px; font-weight: ${article.isRead ? '500' : '600'}; color: #1a1a1a; margin-bottom: 8px; line-height: 1.4;">${stripHtml(article.title)}</div>
        <div style="font-size: 12px; color: #888;"><span style="color: ${feed ? getFeedColor(feed.id) : '#888'};">${feed ? feed.title : 'Unknown'}</span> • ${publishedDate}</div>
      </div>
    `;
  });
  
  html += '</div>';
  container.innerHTML = html;
  attachArticleClickHandlers(articles);
}

function renderInlineLayout(container, articles, feeds) {
  let html = '';
  
  articles.forEach((article) => {
    const feed = feeds.find(f => f.id === article.feedId);
    const publishedDate = article.publishedAt ? new Date(article.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    const isExpanded = state.selectedArticle && state.selectedArticle.id === article.id;
    
    html += `
      <div class="article-card" data-article-id="${article.id}" 
        style="background: #ffffff; border-radius: 8px; margin-bottom: 8px; border: 1px solid ${isExpanded ? '#007aff' : '#e8e8e8'}; overflow: hidden; ${article.isRead && !isExpanded ? 'opacity: 0.65;' : ''}">
        <div class="article-header" style="padding: 16px 20px; cursor: pointer; border-left: 4px solid ${feed ? getFeedColor(feed.id) : '#ccc'};"
          onmouseover="this.style.background='#f8f8f8'" onmouseout="this.style.background='transparent'">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div style="flex: 1;">
              <div style="font-size: 16px; font-weight: ${article.isRead ? '500' : '600'}; color: #1a1a1a; margin-bottom: 6px; line-height: 1.4;">${stripHtml(article.title)}</div>
              <div style="font-size: 12px; color: #888;"><span style="color: #007aff;">${feed ? feed.title : 'Unknown'}</span>${article.author ? ' • ' + stripHtml(article.author) : ''} • ${publishedDate}</div>
            </div>
            <div style="font-size: 18px; color: #888; margin-left: 12px;">${isExpanded ? '▼' : '▶'}</div>
          </div>
        </div>
        ${isExpanded ? `
          <div style="padding: 0 20px 20px 24px; border-top: 1px solid #eee;">
            <div style="font-size: ${state.articleFontSize}px; line-height: 1.7; color: #333; padding-top: 16px;">${formatArticleContent(state.selectedArticle.content || state.selectedArticle.summary || 'No content available.', state.selectedArticle.id)}</div>
            <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #eee; display: flex; gap: 12px;">
              <button class="btn-inline-share" data-url="${article.url}" data-title="${stripHtml(article.title).replace(/"/g, '&quot;')}" style="padding: 8px 16px; font-size: 13px; cursor: pointer; background: #34c759; color: white; border: none; border-radius: 6px;">📋 Share</button>
              <button class="btn-inline-open" data-url="${article.url}" style="padding: 8px 16px; font-size: 13px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">Open in Browser ↗</button>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  document.querySelectorAll('.article-card').forEach(card => {
    const header = card.querySelector('.article-header');
    if (header) {
      header.addEventListener('click', async () => {
        const articleId = card.dataset.articleId;
        const article = articles.find(a => a.id === articleId);
        if (article) {
          await markArticleRead(articleId);
          if (state.selectedArticle && state.selectedArticle.id === articleId) {
            state.selectedArticle = null;
          } else {
            state.selectedArticle = article;
            const textContent = stripHtml(article.content || '');
            const isTruncated = textContent.includes('Read the full story') || textContent.includes('Continue reading') || textContent.includes('Read more') || textContent.length < 500;
            if (!article.content || isTruncated) {
              const result = await extractArticle(article.url);
              if (result.success && result.content) state.selectedArticle = { ...article, content: result.content };
            }
          }
          renderArticles();
        }
      });
    }
  });
  
  document.querySelectorAll('.btn-inline-share').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(`${btn.dataset.title}\n${btn.dataset.url}`);
        btn.textContent = '✓ Copied!';
        setTimeout(() => { btn.textContent = '📋 Share'; }, 2000);
      } catch (err) { console.error('Failed to copy:', err); }
    });
  });
  
  document.querySelectorAll('.btn-inline-open').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); window.open(btn.dataset.url, '_blank'); });
  });
}
function renderNotesView() {
  const container = document.getElementById('articles-list');
  const statusBar = document.getElementById('status-bar');
  
  let notes = getAllNotes();
  const noteTags = getAllNoteTags();
  
  // Apply tag filter
  if (state.notesTagFilter) {
    notes = notes.filter(n => n.tags.includes(state.notesTagFilter));
  }
  
  // Apply search filter
  if (state.notesSearchQuery && state.notesSearchQuery.trim()) {
    const query = state.notesSearchQuery.toLowerCase().trim();
    notes = notes.filter(n => {
      const highlight = (n.highlightedText || '').toLowerCase();
      const annotation = (n.annotation || '').toLowerCase();
      const title = (n.articleTitle || '').toLowerCase();
      const feedTitle = (n.feedTitle || '').toLowerCase();
      const tags = (n.tags || []).join(' ').toLowerCase();
      
      return highlight.includes(query) || 
             annotation.includes(query) || 
             title.includes(query) || 
             feedTitle.includes(query) ||
             tags.includes(query);
    });
  }
  
  // Sort notes
  switch (state.notesSort) {
    case 'oldest':
      notes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case 'publication':
      notes.sort((a, b) => (a.feedTitle || '').localeCompare(b.feedTitle || ''));
      break;
    case 'tag':
      notes.sort((a, b) => (a.tags[0] || '').localeCompare(b.tags[0] || ''));
      break;
    default: // newest
      notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  
  statusBar.textContent = `Notes — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${state.notesTagFilter ? ` (filtered by: ${state.notesTagFilter})` : ''}`;
  
  if (notes.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: #999;">
        <div style="font-size: 48px; margin-bottom: 16px;">📝</div>
        <p style="font-size: 18px; margin-bottom: 8px; color: #666;">No notes yet</p>
        <p style="font-size: 14px;">Highlight text in articles to create notes.</p>
      </div>
    `;
    return;
  }
  
  let html = `
    <!-- Notes Controls -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; padding: 12px; background: white; border-radius: 8px; border: 1px solid #e8e8e8;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="position: relative;">
          <input type="text" id="notes-search-input" placeholder="🔍 Search notes..." value="${state.notesSearchQuery}" 
            style="padding: 6px 12px; padding-right: 28px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; width: 150px; outline: none;">
          ${state.notesSearchQuery ? `<button id="btn-clear-notes-search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #999; padding: 0;">×</button>` : ''}
        </div>
        <label style="font-size: 12px; color: #666;">Sort:</label>
        <select id="notes-sort-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="newest" ${state.notesSort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest" ${state.notesSort === 'oldest' ? 'selected' : ''}>Oldest</option>
          <option value="publication" ${state.notesSort === 'publication' ? 'selected' : ''}>Publication</option>
          <option value="tag" ${state.notesSort === 'tag' ? 'selected' : ''}>Tag</option>
        </select>
        
        <label style="font-size: 12px; color: #666; margin-left: 8px;">Filter:</label>
        <select id="notes-tag-filter" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="">All Tags</option>
          ${noteTags.map(t => `<option value="${t.name}" ${state.notesTagFilter === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
      
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 12px; color: #666;">${state.selectedNotes.size} selected</span>
        <button id="btn-export-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${state.selectedNotes.size > 0 ? '#007aff' : '#e8e8e8'}; color: ${state.selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${state.selectedNotes.size === 0 ? 'disabled' : ''}>
          Export Selected
        </button>
        <button id="btn-delete-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${state.selectedNotes.size > 0 ? '#ff3b30' : '#e8e8e8'}; color: ${state.selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${state.selectedNotes.size === 0 ? 'disabled' : ''}>
          Delete Selected
        </button>
        <button id="btn-select-all-notes" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: #e8e8e8; color: #333; border: none; border-radius: 4px;">
          ${state.selectedNotes.size === notes.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
    </div>
  `;
  
  notes.forEach(note => {
    const isSelected = state.selectedNotes.has(note.id);
    const citation = generateAPACitation(note);
    const createdDate = new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    
    html += `
      <div class="note-card" data-note-id="${note.id}" style="background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; border: 2px solid ${isSelected ? '#007aff' : '#e8e8e8'};">
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <input type="checkbox" class="note-checkbox" data-note-id="${note.id}" ${isSelected ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
            <div>
              <div style="font-size: 14px; font-weight: 600; color: #1a1a1a;">${stripHtml(note.articleTitle)}</div>
              <div style="font-size: 12px; color: #666;">${note.feedTitle} • ${createdDate}</div>
            </div>
          </div>
          <div style="display: flex; gap: 4px;">
            <button class="btn-view-article" data-article-id="${note.articleId}" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="View article">📄</button>
            <button class="btn-copy-note" data-note-id="${note.id}" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="Copy to clipboard">📋</button>
            <button class="btn-edit-note" data-note-id="${note.id}" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="Edit">✏️</button>
            <button class="btn-export-note" data-note-id="${note.id}" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="Export">📤</button>
            <button class="btn-delete-note" data-note-id="${note.id}" style="background: none; border: none; cursor: pointer; font-size: 14px; padding: 4px 8px;" title="Delete">🗑️</button>
          </div>
        </div>
        
        ${note.highlightedText ? `
          <div style="background: #fffde7; border-left: 4px solid #ffd54f; padding: 12px; margin-bottom: 12px; border-radius: 0 6px 6px 0;">
            <div style="font-size: 12px; color: #888; margin-bottom: 4px;">HIGHLIGHT</div>
            <div style="font-size: 14px; color: #333; font-style: italic;">"${stripHtml(note.highlightedText)}"</div>
          </div>
        ` : ''}
        
        ${note.annotation ? `
          <div style="background: #e3f2fd; border-left: 4px solid #2196f3; padding: 12px; margin-bottom: 12px; border-radius: 0 6px 6px 0;">
            <div style="font-size: 12px; color: #888; margin-bottom: 4px;">ANNOTATION</div>
            <div style="font-size: 14px; color: #333;">${stripHtml(note.annotation)}</div>
          </div>
        ` : ''}
        
        ${note.tags.length > 0 ? `
          <div style="margin-bottom: 12px;">
            ${note.tags.map(tag => `<span style="display: inline-block; padding: 4px 10px; background: #e8e8e8; border-radius: 12px; font-size: 12px; color: #555; margin-right: 6px;">${tag}</span>`).join('')}
          </div>
        ` : ''}
        
        <div style="background: #f5f5f5; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: #666;">
          <strong>Citation (APA):</strong> ${citation}
        </div>
      </div>
    `;
  });
  
  container.innerHTML = html;
  
  // Event listeners
  const notesSearchInput = document.getElementById('notes-search-input');
  notesSearchInput.addEventListener('input', (e) => {
    state.notesSearchQuery = e.target.value;
    const cursorPos = e.target.selectionStart;
    renderNotesView();
    // Restore focus and cursor position
    const newInput = document.getElementById('notes-search-input');
    newInput.focus();
    newInput.setSelectionRange(cursorPos, cursorPos);
  });
  
  document.getElementById('notes-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.notesSearchQuery = '';
      e.target.value = '';
      renderNotesView();
    }
  });
  
  const clearNotesSearchBtn = document.getElementById('btn-clear-notes-search');
  if (clearNotesSearchBtn) {
    clearNotesSearchBtn.addEventListener('click', () => {
      state.notesSearchQuery = '';
      renderNotesView();
    });
  }
  
  document.getElementById('notes-sort-select').addEventListener('change', (e) => {
    state.notesSort = e.target.value;
    renderNotesView();
  });
  
  document.getElementById('notes-tag-filter').addEventListener('change', (e) => {
    state.notesTagFilter = e.target.value || null;
    state.selectedNotes.clear();
    renderNotesView();
  });
  
  document.getElementById('btn-select-all-notes').addEventListener('click', () => {
    if (state.selectedNotes.size === notes.length) {
      state.selectedNotes.clear();
    } else {
      notes.forEach(n => state.selectedNotes.add(n.id));
    }
    renderNotesView();
  });
  
  document.getElementById('btn-export-selected').addEventListener('click', () => {
    if (state.selectedNotes.size === 0) return;
    const notesToExport = notes.filter(n => state.selectedNotes.has(n.id));
    downloadNotesAsText(notesToExport);
  });
  
  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    if (state.selectedNotes.size === 0) return;
    await deleteMultipleNotes(Array.from(state.selectedNotes));
    state.selectedNotes.clear();
    renderApp();
  });
  
  document.querySelectorAll('.note-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const noteId = e.target.dataset.noteId;
      if (e.target.checked) {
        state.selectedNotes.add(noteId);
      } else {
        state.selectedNotes.delete(noteId);
      }
      renderNotesView();
    });
  });
  
  document.querySelectorAll('.btn-edit-note').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteId = btn.dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) showEditNoteDialog(note, renderApp);
    });
  });
  
  document.querySelectorAll('.btn-export-note').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteId = btn.dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) downloadNotesAsText([note]);
    });
  });
  document.querySelectorAll('.btn-view-article').forEach(btn => {
    btn.addEventListener('click', async () => {
      const articleId = btn.dataset.articleId;
      const article = getData().articles.find(a => a.id === articleId);
      if (article) {
        state.showNotesView = false;
        state.currentFeedId = null;
        state.currentFolderId = null;
        state.selectedArticle = article;
        await markArticleRead(article.id);
        renderApp();
      } else {
        alert('Article no longer exists');
      }
    });
  });
  document.querySelectorAll('.btn-copy-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) {
        let copyText = '';
        if (note.highlightedText) {
          copyText += `"${note.highlightedText}"\n\n`;
        }
        if (note.annotation) {
          copyText += `${note.annotation}\n\n`;
        }
        copyText += `— ${generateAPACitation(note)}`;
        
        try {
          await navigator.clipboard.writeText(copyText);
          btn.textContent = '✓';
          setTimeout(() => { btn.textContent = '📋'; }, 1500);
        } catch (err) {
          console.error('Copy failed:', err);
        }
      }
    });
  });
  
  document.querySelectorAll('.btn-delete-note').forEach(btn => {
    btn.addEventListener('click', async () => {
      const noteId = btn.dataset.noteId;
      await deleteNote(noteId);
      renderApp();
    });
  });
}

function downloadNotesAsText(notes) {
  const text = exportNotesToText(notes);
  
  // Show export dialog with text
  const dialogHtml = `
    <div id="export-dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 600px; max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h3 style="margin: 0 0 16px 0; font-size: 18px;">Export Notes (${notes.length} ${notes.length === 1 ? 'note' : 'notes'})</h3>
        <textarea id="export-text" readonly style="flex: 1; min-height: 300px; padding: 12px; font-size: 13px; font-family: monospace; border: 1px solid #d0d0d0; border-radius: 6px; resize: none; background: #f9f9f9;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
        <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px;">
          <button id="export-copy-btn" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">
            📋 Copy to Clipboard
          </button>
          <button id="export-close-btn" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 6px;">
            Close
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHtml);
  
  const dialog = document.getElementById('export-dialog');
  const textarea = document.getElementById('export-text');
  const copyBtn = document.getElementById('export-copy-btn');
  const closeBtn = document.getElementById('export-close-btn');
  
  // Set actual text value (not HTML-escaped)
  textarea.value = text;
  
  const closeDialog = () => dialog.remove();
  
  closeBtn.addEventListener('click', closeDialog);
  
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy to Clipboard'; }, 2000);
    } catch (err) {
      // Fallback: select text
      textarea.select();
      document.execCommand('copy');
      copyBtn.textContent = '✓ Copied!';
      setTimeout(() => { copyBtn.textContent = '📋 Copy to Clipboard'; }, 2000);
    }
  });
  
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}

function attachArticleClickHandlers(articles) {
  document.querySelectorAll('.article-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      const articleId = card.dataset.articleId;
      const article = articles.find(a => a.id === articleId);
      if (!article) return;
      
      // Cmd+click (Mac) or Ctrl+click (Windows) for multi-select
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
        if (state.selectedArticles.has(articleId)) {
          state.selectedArticles.delete(articleId);
        } else {
          state.selectedArticles.add(articleId);
        }
        renderApp();
        return;
      }
      
      // Normal click - clear selection and open article
      state.selectedArticles.clear();

      // Preserve article list scroll position before the full re-render
      const articleList = document.getElementById('articles-list');
      state.savedArticleListScroll = articleList ? articleList.scrollTop : 0;

      await markArticleRead(articleId);
      state.selectedArticle = article;
      state.isLoadingArticle = true;
      renderApp(); // First render: layout + loading spinner

      const textContent = stripHtml(article.content || '');
      const isTruncated = textContent.includes('Read the full story') || textContent.includes('Continue reading') || textContent.includes('Read more') || textContent.length < 500;
      if (!article.content || isTruncated) {
        const result = await extractArticle(article.url);
        if (result.success && result.content) state.selectedArticle = { ...article, content: result.content };
      }

      state.isLoadingArticle = false;
      // Targeted update: only the article content div changes; list scroll is untouched
      renderArticlePaneContent();
      saveReadingPosition();
    });
  });
}

async function handleAddFeed() {
  const input = document.getElementById('feed-url-input');
  const url = input.value.trim();
  if (!url) { alert('Please enter a feed URL'); return; }
  
  const statusBar = document.getElementById('status-bar');
  statusBar.textContent = 'Adding feed...';
  
  const feed = await addFeed(url);
  input.value = '';
  
  statusBar.textContent = 'Fetching articles...';
  const result = await refreshFeed(feed.id);
  
  statusBar.textContent = result.success ? `Added "${feed.title}" with ${result.newArticles} articles` : `Added feed but fetch failed: ${result.error}`;
  renderApp();
}

async function handleRefreshAll() {
  const statusBar = document.getElementById('status-bar');
  const feeds = getAllFeeds();

  if (feeds.length === 0) {
    statusBar.textContent = 'No feeds to refresh. Add a feed first!';
    return;
  }

  const maxAgeDays = parseInt(document.getElementById('fetch-age-select')?.value) || 7;

  // Disable the Refresh button while running so it can't be double-clicked
  const refreshBtn = document.getElementById('btn-refresh-all');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '↻ Refreshing…'; }

  statusBar.textContent = `Starting refresh of ${feeds.length} feeds…`;

  const results = await refreshAllFeeds(maxAgeDays, (done, total, currentResults) => {
    const newSoFar = currentResults.reduce((sum, r) => sum + (r.newArticles || 0), 0);
    statusBar.textContent = `Refreshing… ${done} / ${total} feeds  ·  ${newSoFar} new articles`;
    // Render new articles as they arrive so the list updates in real time
    renderArticles();
  });

  const totalNew = results.reduce((sum, r) => sum + (r.newArticles || 0), 0);
  const failures  = results.filter(r => !r.success).length;

  if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }

  statusBar.textContent = `✓ Refreshed ${results.length} feeds — ${totalNew} new articles${failures > 0 ? `  ·  ${failures} failed` : ''}`;
  renderArticles();
}

init();