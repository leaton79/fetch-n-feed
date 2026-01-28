// main.js - Fetch N Feed entry point

import { loadData, getData, updateData, exportData } from './database.js';
import { addFeed, getAllFeeds, getAllArticles, getArticlesByFeed, deleteFeed, markArticleRead, toggleArticleStar, toggleArticleArchive, deleteArticle, deleteMultipleArticles, refreshFeed, refreshAllFeeds, addFolder, deleteFolder, getAllFolders, updateFeed, addNote, updateNote, deleteNote, deleteMultipleNotes, getAllNotes, getNotesByTag, getAllNoteTags, addNoteTag, deleteNoteTag, generateAPACitation, exportNotesToText } from './feedManager.js';
import { downloadOPML, parseOPML } from './opml.js';

let savedArticleListScroll = 0;
let currentFeedId = null;
let currentSort = 'newest';
let selectedArticle = null;
let isLoadingArticle = false;
let sidebarWidth = 260;
let articleListWidth = 350;
let articleFontSize = 16;
let currentLayout = 'list';
let currentFilter = 'all'; // all, unread, starred, archived
let currentFolderId = null;
let expandedFolders = new Set();
let showNotesView = false;
let notesSort = 'newest'; // newest, oldest, publication, tag
let notesTagFilter = null;
let selectedNotes = new Set();
let editingNote = null;
let searchQuery = '';
let notesSearchQuery = '';
let fetchAgeDays = 7;
let feedSearchQuery = '';
let selectedArticles = new Set();
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
  
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyboard);
}

function handleKeyboard(e) {
  // Don't trigger shortcuts when typing in input fields
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
    return;
  }
  
  const feeds = getAllFeeds();
  const allArticles = getData().articles;
  let articles = currentFeedId 
    ? allArticles.filter(a => a.feedId === currentFeedId)
    : allArticles;
  
  // Apply current filter
  switch (currentFilter) {
    case 'unread': articles = articles.filter(a => !a.isRead); break;
    case 'starred': articles = articles.filter(a => a.isStarred); break;
    case 'archived': articles = articles.filter(a => a.isArchived); break;
    default: articles = articles.filter(a => !a.isArchived);
  }
  articles = sortArticles(articles, feeds);
  
  const currentIndex = selectedArticle 
    ? articles.findIndex(a => a.id === selectedArticle.id) 
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
      if (selectedArticle) {
        e.preventDefault();
        window.open(selectedArticle.url, '_blank');
      }
      break;
      
    case 's':
      if (selectedArticle) {
        e.preventDefault();
        toggleArticleStar(selectedArticle.id).then(() => {
          selectedArticle = { ...selectedArticle, isStarred: !selectedArticle.isStarred };
          renderApp();
        });
      }
      break;
      
    case 'a':
      if (selectedArticle) {
        e.preventDefault();
        toggleArticleArchive(selectedArticle.id).then(() => {
          selectedArticle = { ...selectedArticle, isArchived: !selectedArticle.isArchived };
          renderApp();
        });
      }
      break;
      
    case 'Escape':
      if (selectedArticle) {
        e.preventDefault();
        selectedArticle = null;
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
  // Save scroll position to global variable before re-render
  const articleList = document.getElementById('articles-list');
  savedArticleListScroll = articleList ? articleList.scrollTop : 0;
  
  await markArticleRead(article.id);
  selectedArticle = article;
  isLoadingArticle = true;
  renderApp();
  
  const textContent = stripHtml(article.content || '');
  const isTruncated = textContent.includes('Read the full story') || 
                     textContent.includes('Continue reading') || 
                     textContent.includes('Read more') || 
                     textContent.length < 500;
  if (!article.content || isTruncated) {
    const result = await extractArticle(article.url);
    if (result.success && result.content) {
      selectedArticle = { ...article, content: result.content };
    }
  }
  
  isLoadingArticle = false;
  renderApp();
}

function showKeyboardHelp() {
  const helpHtml = `
    <div id="keyboard-help" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="background: white; border-radius: 12px; padding: 24px 32px; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h2 style="margin: 0 0 16px 0; font-size: 20px;">Keyboard Shortcuts</h2>
        <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">↑ / ↓</td><td style="padding: 8px 0;">Scroll in article</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">Shift+↑ / k</td><td style="padding: 8px 0;">Previous article</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">Shift+↓ / j</td><td style="padding: 8px 0;">Next article</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">Enter / o</td><td style="padding: 8px 0;">Open in browser</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">s</td><td style="padding: 8px 0;">Star / unstar</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">a</td><td style="padding: 8px 0;">Archive / unarchive</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">r</td><td style="padding: 8px 0;">Refresh all feeds</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">Escape</td><td style="padding: 8px 0;">Close article</td></tr>
          <tr><td style="padding: 8px 16px 8px 0; color: #666;">?</td><td style="padding: 8px 0;">Show this help</td></tr>
        </table>
        <button onclick="document.getElementById('keyboard-help').remove()" style="margin-top: 20px; padding: 10px 20px; font-size: 14px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px; width: 100%;">
          Close
        </button>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', helpHtml);
  
  // Close on click outside or Escape
  document.getElementById('keyboard-help').addEventListener('click', (e) => {
    if (e.target.id === 'keyboard-help') {
      document.getElementById('keyboard-help').remove();
    }
  });
}
function showFolderDialog() {
  const dialogHtml = `
    <div id="folder-dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 300px; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h3 style="margin: 0 0 16px 0; font-size: 18px;">New Folder</h3>
        <input type="text" id="folder-name-input" placeholder="Folder name..." 
          style="width: 100%; padding: 10px 12px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; margin-bottom: 16px; outline: none;">
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="folder-dialog-cancel" style="padding: 8px 16px; font-size: 14px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 6px;">
            Cancel
          </button>
          <button id="folder-dialog-create" style="padding: 8px 16px; font-size: 14px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">
            Create
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHtml);
  
  const dialog = document.getElementById('folder-dialog');
  const input = document.getElementById('folder-name-input');
  const cancelBtn = document.getElementById('folder-dialog-cancel');
  const createBtn = document.getElementById('folder-dialog-create');
  
  input.focus();
  
  const closeDialog = () => dialog.remove();
  
  const createFolder = async () => {
    const name = input.value.trim();
    if (name) {
      await addFolder(name);
      closeDialog();
      renderApp();
    }
  };
  
  cancelBtn.addEventListener('click', closeDialog);
  createBtn.addEventListener('click', createFolder);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createFolder();
    if (e.key === 'Escape') closeDialog();
  });
  
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}
function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

function truncate(text, maxLength) {
  const clean = stripHtml(text).trim();
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength).trim() + '...';
}
function applyHighlight(html, highlightText) {
  // First try exact match (works when no HTML tags break up the text)
  const escaped = highlightText
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+');
  
  try {
    const exactRegex = new RegExp(`(${escaped})`, 'gi');
    if (exactRegex.test(html)) {
      return html.replace(exactRegex, `<mark style="background: #fff59d; padding: 2px 0; border-radius: 2px;" title="Note saved">$1</mark>`);
    }
  } catch (e) { }
  
  // If exact match fails, build a regex that allows HTML tags between words
  const words = highlightText
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 0)
    .map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  
  if (words.length === 0) return html;
  
  // Allow HTML tags and whitespace between words
  const flexiblePattern = words.join('(?:<[^>]*>|\\s)*');
  
  try {
    const flexRegex = new RegExp(`(${flexiblePattern})`, 'gi');
    return html.replace(flexRegex, `<mark style="background: #fff59d; padding: 2px 0; border-radius: 2px;" title="Note saved">$1</mark>`);
  } catch (e) {
    console.log('Flexible highlight failed:', e);
  }
  
  return html;
}
function formatArticleContent(content, articleId = null) {
  if (!content) return '<p>No content available.</p>';
  
  let formatted;
  
  if (content.includes('<p>') || content.includes('<div>') || content.includes('<img')) {
    formatted = content.replace(/<img([^>]*)>/gi, (match, attrs) => {
      const cleanAttrs = attrs
        .replace(/width\s*=\s*["'][^"']*["']/gi, '')
        .replace(/height\s*=\s*["'][^"']*["']/gi, '')
        .replace(/style\s*=\s*["'][^"']*["']/gi, '');
      return `<img${cleanAttrs} style="max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; display: block;">`;
    });
  } else {
    formatted = content
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
  
// Apply saved highlights from notes
  if (articleId) {
    const allNotes = getAllNotes();
    const notes = allNotes.filter(n => n.articleId === articleId && n.highlightedText);
    
    for (const note of notes) {
      const highlightText = note.highlightedText;
      if (highlightText && highlightText.length > 3) {
        formatted = applyHighlight(formatted, highlightText);
      }
    }
  }
  
  return formatted;
}

function sortArticles(articles, feeds) {
  const sorted = [...articles];
  
  switch (currentSort) {
    case 'newest':
      return sorted.sort((a, b) => (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt));
    case 'oldest':
      return sorted.sort((a, b) => (a.publishedAt || a.fetchedAt).localeCompare(b.publishedAt || b.fetchedAt));
    case 'feedAZ':
      return sorted.sort((a, b) => {
        const feedA = feeds.find(f => f.id === a.feedId)?.title || '';
        const feedB = feeds.find(f => f.id === b.feedId)?.title || '';
        const cmp = feedA.localeCompare(feedB);
        return cmp !== 0 ? cmp : (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt);
      });
    case 'feedZA':
      return sorted.sort((a, b) => {
        const feedA = feeds.find(f => f.id === a.feedId)?.title || '';
        const feedB = feeds.find(f => f.id === b.feedId)?.title || '';
        const cmp = feedB.localeCompare(feedA);
        return cmp !== 0 ? cmp : (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt);
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
      
      <div id="sidebar" style="width: ${sidebarWidth}px; background: #ffffff; padding: 16px; border-right: none; overflow-y: auto; flex-shrink: 0;">
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
            <option value="1" ${fetchAgeDays === 1 ? 'selected' : ''}>24 hours</option>
            <option value="7" ${fetchAgeDays === 7 ? 'selected' : ''}>7 days</option>
            <option value="14" ${fetchAgeDays === 14 ? 'selected' : ''}>2 weeks</option>
            <option value="30" ${fetchAgeDays === 30 ? 'selected' : ''}>1 month</option>
            <option value="90" ${fetchAgeDays === 90 ? 'selected' : ''}>3 months</option>
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
              <a href="#" id="btn-all-articles" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${currentFilter === 'all' && currentFeedId === null ? '#007aff' : 'transparent'}; color: ${currentFilter === 'all' && currentFeedId === null ? 'white' : '#333'}; text-decoration: none; border-radius: 6px; font-weight: ${currentFilter === 'all' ? '500' : 'normal'};">
                <span>📚 All Articles</span>
                <span style="color: ${currentFilter === 'all' && currentFeedId === null ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${allCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-unread" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${currentFilter === 'unread' ? '#007aff' : 'transparent'}; color: ${currentFilter === 'unread' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📩 Unread</span>
                <span style="color: ${currentFilter === 'unread' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${unreadCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-starred" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${currentFilter === 'starred' ? '#007aff' : 'transparent'}; color: ${currentFilter === 'starred' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>⭐ Starred</span>
                <span style="color: ${currentFilter === 'starred' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${starredCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 8px;">
              <a href="#" id="btn-archived" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${currentFilter === 'archived' ? '#007aff' : 'transparent'}; color: ${currentFilter === 'archived' ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📦 Archived</span>
                <span style="color: ${currentFilter === 'archived' ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${archivedCount}</span>
              </a>
            </div>
            <div style="margin-bottom: 4px;">
              <a href="#" id="btn-notes" style="display: flex; justify-content: space-between; padding: 10px 12px; background: ${showNotesView ? '#007aff' : 'transparent'}; color: ${showNotesView ? 'white' : '#333'}; text-decoration: none; border-radius: 6px;">
                <span>📝 Notes</span>
                <span style="color: ${showNotesView ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">${(getData().notes || []).length}</span>
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
        <input type="text" id="feed-search-input" placeholder="Filter feeds..." value="${feedSearchQuery}"
          style="width: 100%; padding: 6px 10px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box; margin-bottom: 8px; outline: none;">
        <div id="feeds-list"></div>
      </div>
      
      <div id="sidebar-resize" style="width: 5px; background: #e0e0e0; cursor: col-resize; flex-shrink: 0;" onmouseover="this.style.background='#007aff'" onmouseout="this.style.background='#e0e0e0'"></div>
      
      <div style="flex: 1; display: flex; overflow: hidden;">
        
        <div id="article-list-panel" style="width: ${selectedArticle && currentLayout !== 'inline' ? articleListWidth + 'px' : '100%'}; display: flex; flex-direction: column; overflow: hidden; background: #fafafa; flex-shrink: 0;">
          
          <div style="padding: 12px 16px; background: #ffffff; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 12px;">
              <div id="status-bar" style="font-size: 14px; color: #666;"></div>
              <button id="btn-mark-all-read" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #e8e8e8; color: #555; border: none; border-radius: 4px; white-space: nowrap;">
                ✓ Mark All Read
              </button>
              ${selectedArticles.size > 0 ? `
              <span style="font-size: 11px; color: #666;">${selectedArticles.size} selected</span>
              <button id="btn-delete-selected" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #ff3b30; color: white; border: none; border-radius: 4px; white-space: nowrap;">
                🗑️ Delete Selected
              </button>
              <button id="btn-clear-selection" style="padding: 4px 8px; font-size: 11px; cursor: pointer; background: #e8e8e8; color: #555; border: none; border-radius: 4px; white-space: nowrap;">
                ✕ Clear
              </button>
              ` : ''}
              <div style="position: relative;">
                <input type="text" id="search-input" placeholder="🔍 Search articles..." value="${searchQuery}" 
                  style="padding: 6px 12px; padding-right: 28px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; width: 180px; outline: none;">
                ${searchQuery ? `<button id="btn-clear-search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #999; padding: 0;">×</button>` : ''}
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div style="display: flex; align-items: center; gap: 4px;">
                <label style="font-size: 12px; color: #666;">View:</label>
                <select id="layout-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white; cursor: pointer;">
                  <option value="list" ${currentLayout === 'list' ? 'selected' : ''}>📋 List</option>
                  <option value="grid" ${currentLayout === 'grid' ? 'selected' : ''}>▦ Grid</option>
                  <option value="magazine" ${currentLayout === 'magazine' ? 'selected' : ''}>📰 Magazine</option>
                  <option value="inline" ${currentLayout === 'inline' ? 'selected' : ''}>📄 Inline</option>
                </select>
              </div>
              <div style="display: flex; align-items: center; gap: 4px;">
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
          </div>
          
          <div id="articles-list" style="flex: 1; overflow-y: auto; padding: 12px;"></div>
        </div>
        
        ${selectedArticle && currentLayout !== 'inline' ? `<div id="articlelist-resize" style="width: 5px; background: #e0e0e0; cursor: col-resize; flex-shrink: 0;" onmouseover="this.style.background='#007aff'" onmouseout="this.style.background='#e0e0e0'"></div>` : ''}
        
        ${selectedArticle && currentLayout !== 'inline' ? `
        <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden; background: #ffffff;">
          
          <div style="padding: 12px 20px; background: #f8f8f8; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-close-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 4px;">
              ← Back
            </button>
            <div style="display: flex; gap: 8px; align-items: center;">
              <div style="display: flex; align-items: center; gap: 4px; background: #e8e8e8; border-radius: 4px; padding: 2px;">
                <button id="btn-font-decrease" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A-</button>
                <span style="font-size: 12px; color: #666; min-width: 35px; text-align: center;">${articleFontSize}px</span>
                <button id="btn-font-increase" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A+</button>
              </div>
              <button id="btn-star-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${selectedArticle.isStarred ? '#ff9500' : '#e8e8e8'}; color: ${selectedArticle.isStarred ? 'white' : '#333'}; border: none; border-radius: 4px;">
                ${selectedArticle.isStarred ? '★ Starred' : '☆ Star'}
              </button>
              <button id="btn-archive-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${selectedArticle.isArchived ? '#8e8e93' : '#e8e8e8'}; color: ${selectedArticle.isArchived ? 'white' : '#333'}; border: none; border-radius: 4px;">
                ${selectedArticle.isArchived ? '📦 Archived' : '📥 Archive'}
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
              <div id="article-text" style="font-size: ${articleFontSize}px; line-height: 1.7; color: #333;">
                ${formatArticleContent(selectedArticle.content || selectedArticle.summary || 'No content available.', selectedArticle.id)}
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
    showFolderDialog();
  });
  document.getElementById('btn-all-articles').addEventListener('click', (e) => {
    e.preventDefault();
    showNotesView = false;
    currentFeedId = null;
    currentFilter = 'all';
    selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-unread').addEventListener('click', (e) => {
    e.preventDefault();
    showNotesView = false;
    currentFeedId = null;
    currentFilter = 'unread';
    selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-starred').addEventListener('click', (e) => {
    e.preventDefault();
    showNotesView = false;
    currentFeedId = null;
    currentFilter = 'starred';
    selectedArticle = null;
    renderApp();
  });
  
  document.getElementById('btn-archived').addEventListener('click', (e) => {
    e.preventDefault();
    showNotesView = false;
    currentFeedId = null;
    currentFilter = 'archived';
    selectedArticle = null;
    renderApp();
  });
  document.getElementById('btn-notes').addEventListener('click', (e) => {
    e.preventDefault();
    showNotesView = true;
    currentFeedId = null;
    currentFolderId = null;
    selectedArticle = null;
    renderApp();
  });
  document.getElementById('sort-select').addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderArticles();
  });
  document.getElementById('layout-select').addEventListener('change', (e) => {
    currentLayout = e.target.value;
    selectedArticle = null;
    renderArticles();
  });
  document.getElementById('feed-search-input').addEventListener('input', (e) => {
    feedSearchQuery = e.target.value;
    renderFeedsList();
  });
  document.getElementById('fetch-age-select').addEventListener('change', (e) => {
    fetchAgeDays = parseInt(e.target.value) || 7;
    renderArticles();
  });
  document.getElementById('search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderArticles();
  });
  
  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      searchQuery = '';
      e.target.value = '';
      renderArticles();
    }
  });
  
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      searchQuery = '';
      document.getElementById('search-input').value = '';
      renderArticles();
    });
  }
  document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
    const feeds = getAllFeeds();
    const data = getData();
    const allArticlesRaw = data.articles;
    let articlesToMark;
    
    if (currentFeedId) {
      articlesToMark = allArticlesRaw.filter(a => a.feedId === currentFeedId);
    } else if (currentFolderId) {
      const folderFeeds = feeds.filter(f => f.folderIds && f.folderIds.includes(currentFolderId));
      const folderFeedIds = new Set(folderFeeds.map(f => f.id));
      articlesToMark = allArticlesRaw.filter(a => folderFeedIds.has(a.feedId));
    } else {
      articlesToMark = allArticlesRaw;
    }
    
    // Apply current filter
    switch (currentFilter) {
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
      if (selectedArticles.size === 0) return;
      await deleteMultipleArticles(Array.from(selectedArticles));
      selectedArticles.clear();
      selectedArticle = null;
      renderApp();
    });
  }
  
  const clearSelectionBtn = document.getElementById('btn-clear-selection');
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      selectedArticles.clear();
      renderArticles();
    });
  }
  const closeBtn = document.getElementById('btn-close-article');
  if (closeBtn) closeBtn.addEventListener('click', () => { selectedArticle = null; renderApp(); });
  
  const openExternalBtn = document.getElementById('btn-open-external');
  if (openExternalBtn) openExternalBtn.addEventListener('click', () => { if (selectedArticle) window.open(selectedArticle.url, '_blank'); });
  
  const starBtn = document.getElementById('btn-star-article');
  if (starBtn) {
    starBtn.addEventListener('click', async () => {
      if (selectedArticle) {
        await toggleArticleStar(selectedArticle.id);
        selectedArticle = { ...selectedArticle, isStarred: !selectedArticle.isStarred };
        renderApp();
      }
    });
  }
  
  const archiveBtn = document.getElementById('btn-archive-article');
  if (archiveBtn) {
    archiveBtn.addEventListener('click', async () => {
      if (selectedArticle) {
        await toggleArticleArchive(selectedArticle.id);
        selectedArticle = { ...selectedArticle, isArchived: !selectedArticle.isArchived };
        renderApp();
      }
    });
  }
  
  const addNoteBtn = document.getElementById('btn-add-note');
  if (addNoteBtn) {
    addNoteBtn.addEventListener('click', () => {
      if (selectedArticle) {
        const selection = window.getSelection();
        const highlightedText = selection.toString().trim();
        showAddNoteDialog(selectedArticle, highlightedText);
      }
    });
  }
  const deleteArticleBtn = document.getElementById('btn-delete-article');
  if (deleteArticleBtn) {
    deleteArticleBtn.addEventListener('click', async () => {
      if (!selectedArticle) return;
      await deleteArticle(selectedArticle.id);
      selectedArticle = null;
      renderApp();
    });
  }
  const sidebarResize = document.getElementById('sidebar-resize');
  if (sidebarResize) {
    sidebarResize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidth;
      const onMouseMove = (e) => {
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth >= 150 && newWidth <= 500) {
          sidebarWidth = newWidth;
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
      if (articleFontSize > 12) {
        articleFontSize -= 2;
        const textEl = document.getElementById('article-text');
        if (textEl) textEl.style.fontSize = articleFontSize + 'px';
        fontDecreaseBtn.nextElementSibling.textContent = articleFontSize + 'px';
      }
    });
  }
  
  const fontIncreaseBtn = document.getElementById('btn-font-increase');
  if (fontIncreaseBtn) {
    fontIncreaseBtn.addEventListener('click', () => {
      if (articleFontSize < 28) {
        articleFontSize += 2;
        const textEl = document.getElementById('article-text');
        if (textEl) textEl.style.fontSize = articleFontSize + 'px';
        fontIncreaseBtn.previousElementSibling.textContent = articleFontSize + 'px';
      }
    });
  }
  
  const articleListResize = document.getElementById('articlelist-resize');
  if (articleListResize) {
    articleListResize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = articleListWidth;
      const onMouseMove = (e) => {
        const newWidth = startWidth + (e.clientX - startX);
        if (newWidth >= 250 && newWidth <= 600) {
          articleListWidth = newWidth;
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
    const isExpanded = expandedFolders.has(folder.id);
    const isSelected = currentFolderId === folder.id;
    
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
              style="flex: 1; padding: 6px 12px; background: ${currentFeedId === feed.id ? '#007aff' : 'transparent'}; color: ${currentFeedId === feed.id ? 'white' : '#555'}; text-decoration: none; border-radius: 4px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${feed.title} <span style="color: ${currentFeedId === feed.id ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 11px;">(${articleCount})</span>
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
        if (expandedFolders.has(folderId)) {
          expandedFolders.delete(folderId);
        } else {
          expandedFolders.add(folderId);
        }
        renderFoldersList();
      } else {
        // Select folder to view its articles
        currentFolderId = currentFolderId === folderId ? null : folderId;
        currentFeedId = null;
        currentFilter = 'all';
        selectedArticle = null;
        renderApp();
      }
    });
  });
  
  document.querySelectorAll('.btn-delete-folder').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = btn.dataset.folderId;
      await deleteFolder(folderId);
      if (currentFolderId === folderId) currentFolderId = null;
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
      currentFeedId = link.dataset.feedId;
      currentFolderId = null;
      currentFilter = 'all';
      selectedArticle = null;
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
  if (feedSearchQuery && feedSearchQuery.trim()) {
    const query = feedSearchQuery.toLowerCase().trim();
    feeds = feeds.filter(f => f.title.toLowerCase().includes(query));
  }
  if (feeds.length === 0) {
    container.innerHTML = '<div style="color: #999; font-size: 14px; padding: 8px 12px;">No feeds yet</div>';
    return;
  }
  
  container.innerHTML = feeds.map(feed => {
    const articleCount = allArticles.filter(a => a.feedId === feed.id && !a.isArchived).length;
    const unreadCount = allArticles.filter(a => a.feedId === feed.id && !a.isRead && !a.isArchived).length;
    return `
      <div style="display: flex; align-items: center; margin-bottom: 2px;">
        <a href="#" class="feed-link" data-feed-id="${feed.id}" 
          style="flex: 1; padding: 10px 12px; background: ${currentFeedId === feed.id ? '#007aff' : 'transparent'}; color: ${currentFeedId === feed.id ? 'white' : '#333'}; text-decoration: none; border-radius: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px;">
          ${feed.title} <span style="color: ${currentFeedId === feed.id ? 'rgba(255,255,255,0.7)' : '#999'}; font-size: 12px;">(${unreadCount}/${articleCount})</span>
        </a>
        <button class="btn-feed-menu" data-feed-id="${feed.id}" style="background: none; border: none; color: #ccc; cursor: pointer; padding: 4px 6px; font-size: 14px;" onmouseover="this.style.color='#007aff'" onmouseout="this.style.color='#ccc'" title="Add to folder">📁</button>
        <button class="btn-delete-feed" data-feed-id="${feed.id}" style="background: none; border: none; color: #ccc; cursor: pointer; padding: 4px 8px; font-size: 16px;" onmouseover="this.style.color='#ff3b30'" onmouseout="this.style.color='#ccc'">×</button>
      </div>
    `;
  }).join('');
  
  document.querySelectorAll('.feed-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      currentFeedId = e.target.closest('.feed-link').dataset.feedId;
      currentFolderId = null;
      currentFilter = 'all';
      selectedArticle = null;
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
        if (currentFeedId === feedId) currentFeedId = null;
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
  if (showNotesView) {
    renderNotesView();
    return;
  }
  
  const feeds = getAllFeeds();
  
  // Get all articles (we'll filter ourselves)
  const allArticlesRaw = getData().articles;
  let articles;
  
  if (currentFeedId) {
    articles = allArticlesRaw.filter(a => a.feedId === currentFeedId);
  } else if (currentFolderId) {
    const folderFeeds = feeds.filter(f => f.folderIds && f.folderIds.includes(currentFolderId));
    const folderFeedIds = new Set(folderFeeds.map(f => f.id));
    articles = allArticlesRaw.filter(a => folderFeedIds.has(a.feedId));
  } else {
    articles = allArticlesRaw;
  }
  
  // Apply filter
  switch (currentFilter) {
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
  if (searchQuery && searchQuery.trim()) {
    const query = searchQuery.toLowerCase().trim();
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
  
  articles = sortArticles(articles, feeds);
  
  const currentFeed = currentFeedId ? feeds.find(f => f.id === currentFeedId) : null;
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
  
  // Limit articles for performance (render max 100)
  const maxArticles = 100;
  const limitedArticles = articles.slice(0, maxArticles);
  
  switch (currentLayout) {
    case 'grid': renderGridLayout(container, limitedArticles, feeds); break;
    case 'magazine': renderMagazineLayout(container, limitedArticles, feeds); break;
    case 'inline': renderInlineLayout(container, limitedArticles, feeds); break;
    default: renderListLayout(container, limitedArticles, feeds);
  }
  // Restore scroll position if saved
  if (savedArticleListScroll > 0) {
    const articlesList = document.getElementById('articles-list');
    if (articlesList) articlesList.scrollTop = savedArticleListScroll;
  }
}

function renderListLayout(container, articles, feeds) {
  let lastFeedId = null;
  const showFeedHeaders = (currentSort === 'feedAZ' || currentSort === 'feedZA') && !currentFeedId;
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
        style="background: ${selectedArticles.has(article.id) ? '#fff3cd' : (isEven ? '#ffffff' : '#dceaff')}; border-left: 4px solid ${feed ? getFeedColor(feed.id) : '#ccc'}; border-radius: 8px; padding: 16px 20px; margin-bottom: 8px; border: 2px solid ${selectedArticles.has(article.id) ? '#ff9500' : '#e8e8e8'}; cursor: pointer; ${article.isRead ? 'opacity: 0.65;' : ''}"
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
    const isExpanded = selectedArticle && selectedArticle.id === article.id;
    
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
            <div style="font-size: ${articleFontSize}px; line-height: 1.7; color: #333; padding-top: 16px;">${formatArticleContent(selectedArticle.content || selectedArticle.summary || 'No content available.', selectedArticle.id)}</div>
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
          if (selectedArticle && selectedArticle.id === articleId) {
            selectedArticle = null;
          } else {
            selectedArticle = article;
            const textContent = stripHtml(article.content || '');
            const isTruncated = textContent.includes('Read the full story') || textContent.includes('Continue reading') || textContent.includes('Read more') || textContent.length < 500;
            if (!article.content || isTruncated) {
              const result = await extractArticle(article.url);
              if (result.success && result.content) selectedArticle = { ...article, content: result.content };
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
  if (notesTagFilter) {
    notes = notes.filter(n => n.tags.includes(notesTagFilter));
  }
  
  // Apply search filter
  if (notesSearchQuery && notesSearchQuery.trim()) {
    const query = notesSearchQuery.toLowerCase().trim();
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
  switch (notesSort) {
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
  
  statusBar.textContent = `Notes — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${notesTagFilter ? ` (filtered by: ${notesTagFilter})` : ''}`;
  
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
          <input type="text" id="notes-search-input" placeholder="🔍 Search notes..." value="${notesSearchQuery}" 
            style="padding: 6px 12px; padding-right: 28px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; width: 150px; outline: none;">
          ${notesSearchQuery ? `<button id="btn-clear-notes-search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #999; padding: 0;">×</button>` : ''}
        </div>
        <label style="font-size: 12px; color: #666;">Sort:</label>
        <select id="notes-sort-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="newest" ${notesSort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest" ${notesSort === 'oldest' ? 'selected' : ''}>Oldest</option>
          <option value="publication" ${notesSort === 'publication' ? 'selected' : ''}>Publication</option>
          <option value="tag" ${notesSort === 'tag' ? 'selected' : ''}>Tag</option>
        </select>
        
        <label style="font-size: 12px; color: #666; margin-left: 8px;">Filter:</label>
        <select id="notes-tag-filter" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="">All Tags</option>
          ${noteTags.map(t => `<option value="${t.name}" ${notesTagFilter === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>
      
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 12px; color: #666;">${selectedNotes.size} selected</span>
        <button id="btn-export-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${selectedNotes.size > 0 ? '#007aff' : '#e8e8e8'}; color: ${selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${selectedNotes.size === 0 ? 'disabled' : ''}>
          Export Selected
        </button>
        <button id="btn-delete-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${selectedNotes.size > 0 ? '#ff3b30' : '#e8e8e8'}; color: ${selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${selectedNotes.size === 0 ? 'disabled' : ''}>
          Delete Selected
        </button>
        <button id="btn-select-all-notes" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: #e8e8e8; color: #333; border: none; border-radius: 4px;">
          ${selectedNotes.size === notes.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
    </div>
  `;
  
  notes.forEach(note => {
    const isSelected = selectedNotes.has(note.id);
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
    notesSearchQuery = e.target.value;
    const cursorPos = e.target.selectionStart;
    renderNotesView();
    // Restore focus and cursor position
    const newInput = document.getElementById('notes-search-input');
    newInput.focus();
    newInput.setSelectionRange(cursorPos, cursorPos);
  });
  
  document.getElementById('notes-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      notesSearchQuery = '';
      e.target.value = '';
      renderNotesView();
    }
  });
  
  const clearNotesSearchBtn = document.getElementById('btn-clear-notes-search');
  if (clearNotesSearchBtn) {
    clearNotesSearchBtn.addEventListener('click', () => {
      notesSearchQuery = '';
      renderNotesView();
    });
  }
  
  document.getElementById('notes-sort-select').addEventListener('change', (e) => {
    notesSort = e.target.value;
    renderNotesView();
  });
  
  document.getElementById('notes-tag-filter').addEventListener('change', (e) => {
    notesTagFilter = e.target.value || null;
    selectedNotes.clear();
    renderNotesView();
  });
  
  document.getElementById('btn-select-all-notes').addEventListener('click', () => {
    if (selectedNotes.size === notes.length) {
      selectedNotes.clear();
    } else {
      notes.forEach(n => selectedNotes.add(n.id));
    }
    renderNotesView();
  });
  
  document.getElementById('btn-export-selected').addEventListener('click', () => {
    if (selectedNotes.size === 0) return;
    const notesToExport = notes.filter(n => selectedNotes.has(n.id));
    downloadNotesAsText(notesToExport);
  });
  
  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    if (selectedNotes.size === 0) return;
    await deleteMultipleNotes(Array.from(selectedNotes));
    selectedNotes.clear();
    renderApp();
  });
  
  document.querySelectorAll('.note-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const noteId = e.target.dataset.noteId;
      if (e.target.checked) {
        selectedNotes.add(noteId);
      } else {
        selectedNotes.delete(noteId);
      }
      renderNotesView();
    });
  });
  
  document.querySelectorAll('.btn-edit-note').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteId = btn.dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) showEditNoteDialog(note);
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
        showNotesView = false;
        currentFeedId = null;
        currentFolderId = null;
        selectedArticle = article;
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
function showEditNoteDialog(note) {
  const noteTags = getAllNoteTags();
  
  const dialogHtml = `
    <div id="edit-note-dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 500px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h3 style="margin: 0 0 20px 0; font-size: 18px;">Edit Note</h3>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Highlighted Text</label>
          <textarea id="edit-highlight" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; min-height: 80px; resize: vertical;">${note.highlightedText || ''}</textarea>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Annotation</label>
          <textarea id="edit-annotation" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; min-height: 80px; resize: vertical;">${note.annotation || ''}</textarea>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Tags (comma-separated)</label>
          <input type="text" id="edit-tags" value="${note.tags.join(', ')}" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box;">
          ${noteTags.length > 0 ? `<div style="margin-top: 6px; font-size: 11px; color: #888;">Existing tags: ${noteTags.map(t => t.name).join(', ')}</div>` : ''}
        </div>
        
        <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 600; color: #666; margin-bottom: 12px;">Citation Information (APA)</div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Author</label>
            <input type="text" id="edit-citation-author" value="${note.citationAuthor || ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Year</label>
            <input type="text" id="edit-citation-date" value="${note.citationDate || ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Title</label>
            <input type="text" id="edit-citation-title" value="${note.citationTitle || ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Source/Publication</label>
            <input type="text" id="edit-citation-source" value="${note.citationSource || ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div>
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">URL</label>
            <input type="text" id="edit-citation-url" value="${note.citationUrl || ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="edit-note-cancel" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 6px;">
            Cancel
          </button>
          <button id="edit-note-save" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 6px;">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHtml);
  
  const dialog = document.getElementById('edit-note-dialog');
  const cancelBtn = document.getElementById('edit-note-cancel');
  const saveBtn = document.getElementById('edit-note-save');
  
  const closeDialog = () => dialog.remove();
  
  cancelBtn.addEventListener('click', closeDialog);
  
  saveBtn.addEventListener('click', async () => {
    const tagsInput = document.getElementById('edit-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    
    // Create any new tags
    for (const tagName of tags) {
      const existing = getAllNoteTags().find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!existing) {
        await addNoteTag(tagName);
      }
    }
    
    await updateNote(note.id, {
      highlightedText: document.getElementById('edit-highlight').value,
      annotation: document.getElementById('edit-annotation').value,
      tags: tags,
      citationAuthor: document.getElementById('edit-citation-author').value,
      citationDate: document.getElementById('edit-citation-date').value,
      citationTitle: document.getElementById('edit-citation-title').value,
      citationSource: document.getElementById('edit-citation-source').value,
      citationUrl: document.getElementById('edit-citation-url').value,
    });
    
    closeDialog();
    renderApp();
  });
  
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}
function showAddNoteDialog(article, highlightedText = '') {
  const feed = getAllFeeds().find(f => f.id === article.feedId);
  const noteTags = getAllNoteTags();
  
  const dialogHtml = `
    <div id="add-note-dialog" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 500px; max-height: 80vh; overflow-y: auto; box-shadow: 0 8px 32px rgba(0,0,0,0.2);">
        <h3 style="margin: 0 0 8px 0; font-size: 18px;">Add Note</h3>
        <p style="margin: 0 0 20px 0; font-size: 13px; color: #666;">${stripHtml(article.title)}</p>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Highlighted Text (select text in article first, or paste here)</label>
          <textarea id="new-highlight" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; min-height: 80px; resize: vertical;">${highlightedText}</textarea>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Annotation (your notes)</label>
          <textarea id="new-annotation" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box; min-height: 80px; resize: vertical;" placeholder="Add your thoughts, analysis, or notes here..."></textarea>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">Tags (comma-separated)</label>
          <input type="text" id="new-tags" style="width: 100%; padding: 10px; font-size: 14px; border: 1px solid #d0d0d0; border-radius: 6px; box-sizing: border-box;" placeholder="e.g., research, important, follow-up">
          ${noteTags.length > 0 ? `<div style="margin-top: 6px; font-size: 11px; color: #888;">Existing tags: ${noteTags.map(t => t.name).join(', ')}</div>` : ''}
        </div>
        
        <div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 16px;">
          <div style="font-size: 12px; font-weight: 600; color: #666; margin-bottom: 12px;">Citation Information (APA) — editable</div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Author</label>
            <input type="text" id="new-citation-author" value="${article.author ? stripHtml(article.author) : ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Year</label>
            <input type="text" id="new-citation-date" value="${article.publishedAt ? new Date(article.publishedAt).getFullYear() : ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Title</label>
            <input type="text" id="new-citation-title" value="${stripHtml(article.title)}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div style="margin-bottom: 12px;">
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">Source/Publication</label>
            <input type="text" id="new-citation-source" value="${feed ? feed.title : ''}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
          
          <div>
            <label style="display: block; font-size: 11px; color: #888; margin-bottom: 2px;">URL</label>
            <input type="text" id="new-citation-url" value="${article.url}" style="width: 100%; padding: 8px; font-size: 13px; border: 1px solid #d0d0d0; border-radius: 4px; box-sizing: border-box;">
          </div>
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button id="add-note-cancel" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 6px;">
            Cancel
          </button>
          <button id="add-note-save" style="padding: 10px 20px; font-size: 14px; cursor: pointer; background: #9c27b0; color: white; border: none; border-radius: 6px;">
            Save Note
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', dialogHtml);
  
  const dialog = document.getElementById('add-note-dialog');
  const cancelBtn = document.getElementById('add-note-cancel');
  const saveBtn = document.getElementById('add-note-save');
  
  const closeDialog = () => dialog.remove();
  
  cancelBtn.addEventListener('click', closeDialog);
  
  saveBtn.addEventListener('click', async () => {
    const highlightText = document.getElementById('new-highlight').value.trim();
    const annotation = document.getElementById('new-annotation').value.trim();
    
    if (!highlightText && !annotation) {
      alert('Please add a highlight or annotation');
      return;
    }
    
    const tagsInput = document.getElementById('new-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
    
    // Create any new tags
    for (const tagName of tags) {
      const existing = getAllNoteTags().find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!existing) {
        await addNoteTag(tagName);
      }
    }
    
    const feed = getAllFeeds().find(f => f.id === article.feedId);
    
    await addNote({
      articleId: article.id,
      articleTitle: article.title,
      articleUrl: article.url,
      articleAuthor: document.getElementById('new-citation-author').value,
      articlePublishedAt: article.publishedAt,
      feedTitle: feed ? feed.title : '',
      highlightedText: highlightText,
      annotation: annotation,
      tags: tags,
      citationAuthor: document.getElementById('new-citation-author').value,
      citationDate: document.getElementById('new-citation-date').value,
      citationTitle: document.getElementById('new-citation-title').value,
      citationSource: document.getElementById('new-citation-source').value,
      citationUrl: document.getElementById('new-citation-url').value,
    });
    
    closeDialog();
    renderApp();
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
        if (selectedArticles.has(articleId)) {
          selectedArticles.delete(articleId);
        } else {
          selectedArticles.add(articleId);
        }
        renderApp();
        return;
      }
      
      // Normal click - clear selection and open article
      selectedArticles.clear();
      
      // Save scroll position before re-render
      const articleList = document.getElementById('articles-list');
      savedArticleListScroll = articleList ? articleList.scrollTop : 0;
      
      await markArticleRead(articleId);
      selectedArticle = article;
      isLoadingArticle = true;
      renderApp();
      
      const textContent = stripHtml(article.content || '');
      const isTruncated = textContent.includes('Read the full story') || textContent.includes('Continue reading') || textContent.includes('Read more') || textContent.length < 500;
      if (!article.content || isTruncated) {
        const result = await extractArticle(article.url);
        if (result.success && result.content) selectedArticle = { ...article, content: result.content };
      }
      
      isLoadingArticle = false;
      renderApp();
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
  
  if (feeds.length === 0) { statusBar.textContent = 'No feeds to refresh. Add a feed first!'; return; }
  
  const maxAgeDays = parseInt(document.getElementById('fetch-age-select').value) || 7;
  
  statusBar.textContent = 'Refreshing all feeds...';
  const results = await refreshAllFeeds(maxAgeDays);
  const totalNew = results.reduce((sum, r) => sum + (r.newArticles || 0), 0);
  const failures = results.filter(r => !r.success).length;
  
  statusBar.textContent = `Refreshed ${results.length} feeds. ${totalNew} new articles.${failures > 0 ? ` ${failures} failed.` : ''}`;
  renderArticles();
}

init();