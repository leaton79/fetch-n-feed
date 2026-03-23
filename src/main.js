// main.js - Fetch N Feed entry point

import { loadData, getData, updateData, exportData } from './database.js';
import { addFeed, getAllFeeds, getAllArticles, getArticlesByFeed, deleteFeed, markArticleRead, toggleArticleStar, toggleArticleArchive, deleteArticle, deleteMultipleArticles, refreshFeed, refreshAllFeeds, addFolder, deleteFolder, getAllFolders, updateFeed, addNote, updateNote, deleteNote, deleteMultipleNotes, getAllNotes, getNotesByTag, getAllNoteTags, addNoteTag, deleteNoteTag, generateAPACitation, exportNotesToText, cleanupOldArticles } from './feedManager.js';
import { downloadOPML, parseOPML } from './opml.js';
import { state, ARTICLES_PER_PAGE } from './state.js';
import { getFeedColor, stripHtml, truncate, applyHighlight, formatArticleContent, sortArticles } from './utils.js';
import { showKeyboardHelp, showFolderDialog, showEditNoteDialog, showAddNoteDialog } from './views/dialogs.js';
import { renderNotesView, downloadNotesAsText } from './views/notesView.js';
import { extractArticle, renderArticlePaneContent, saveReadingPosition, restoreReadingPosition, selectArticle } from './views/articlePane.js';
import { renderArticles, renderListLayout, renderGridLayout, renderMagazineLayout, renderInlineLayout, attachArticleClickHandlers } from './views/articleList.js';
import { renderFeedsList, handleAddFeed, handleRefreshAll } from './views/sidebar.js';


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
        selectArticle(articles[nextIndex], renderApp);
      }
      break;
      
    case 'k':
      e.preventDefault();
      if (articles.length > 0) {
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : articles.length - 1;
        selectArticle(articles[prevIndex], renderApp);
      }
      break;
    
    case 'ArrowDown':
      if (e.shiftKey) {
        e.preventDefault();
        if (articles.length > 0) {
          const nextIndex = currentIndex < articles.length - 1 ? currentIndex + 1 : 0;
          selectArticle(articles[nextIndex], renderApp);
        }
      }
      // Without shift, let arrow keys scroll naturally
      break;
      
    case 'ArrowUp':
      if (e.shiftKey) {
        e.preventDefault();
        if (articles.length > 0) {
          const prevIndex = currentIndex > 0 ? currentIndex - 1 : articles.length - 1;
          selectArticle(articles[prevIndex], renderApp);
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
      handleRefreshAll(renderApp, renderArticles);
      break;

    case '?':
      e.preventDefault();
      showKeyboardHelp();
      break;
  }
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
  
  document.getElementById('btn-add-feed').addEventListener('click', () => handleAddFeed(renderApp));
  document.getElementById('btn-refresh-all').addEventListener('click', () => handleRefreshAll(renderApp, renderArticles));
  
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
        renderArticles(renderApp);
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
    renderArticles(renderApp);
  });
  document.getElementById('layout-select').addEventListener('change', (e) => {
    state.currentLayout = e.target.value;
    state.selectedArticle = null;
    renderArticles(renderApp);
  });
  document.getElementById('feed-search-input').addEventListener('input', (e) => {
    state.feedSearchQuery = e.target.value;
    renderFeedsList(renderApp);
  });
  document.getElementById('fetch-age-select').addEventListener('change', (e) => {
    state.fetchAgeDays = parseInt(e.target.value) || 7;
    renderArticles(renderApp);
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderArticles(renderApp);
  });
  
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.searchQuery = '';
      e.target.value = '';
      renderArticles(renderApp);
    }
  });
  
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      state.searchQuery = '';
      document.getElementById('search-input').value = '';
      renderArticles(renderApp);
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
    renderArticles(renderApp);
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
      renderArticles(renderApp);
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
  renderFeedsList(renderApp);
  renderArticles(renderApp);
}

init();