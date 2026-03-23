import { getData, updateData } from '../database.js';
import { getAllFeeds, markArticleRead, toggleArticleStar, toggleArticleArchive, deleteArticle } from '../feedManager.js';
import { stripHtml, formatArticleContent } from '../utils.js';
import { state } from '../state.js';
import { showAddNoteDialog } from './dialogs.js';

// ── Callback registry ─────────────────────────────────────────────────────────
// Avoids circular imports: main.js calls initArticlePaneCallbacks() after
// renderApp() so toolbar actions can call back into main's scoped updaters.
let _onRefreshSidebar = null;
let _onRefreshList    = null;

export function initArticlePaneCallbacks({ onRefreshSidebar, onRefreshList }) {
  _onRefreshSidebar = onRefreshSidebar;
  _onRefreshList    = onRefreshList;
}

// Extract full article content from a URL
export async function extractArticle(url) {
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
export function renderArticlePaneContent() {
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
export async function saveReadingPosition() {
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
export function restoreReadingPosition() {
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

export async function selectArticle(article) {
  // Preserve the article list scroll position
  const articleList = document.getElementById('articles-list');
  state.savedArticleListScroll = articleList ? articleList.scrollTop : 0;

  await markArticleRead(article.id);
  state.selectedArticle = article;
  state.isLoadingArticle = true;

  // Show pane with loading spinner — no full renderApp() needed
  openArticlePane();

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
  // Swap in the real content without touching the article list DOM
  renderArticlePaneContent();
  // Update sidebar unread counts
  if (_onRefreshSidebar) _onRefreshSidebar();
  if (_onRefreshList) _onRefreshList();

  // Persist reading position for next launch
  saveReadingPosition();
}

// ── Article pane show / hide ──────────────────────────────────────────────────

export function openArticlePane() {
  if (state.currentLayout === 'inline') {
    renderArticlePaneContent();
    return;
  }
  const pane        = document.getElementById('article-pane');
  const listPanel   = document.getElementById('article-list-panel');
  const resizeHandle = document.getElementById('articlelist-resize');
  if (!pane) return;

  pane.style.display = 'flex';
  if (listPanel)    listPanel.style.width = state.articleListWidth + 'px';
  if (resizeHandle) resizeHandle.style.display = 'block';

  renderArticlePaneToolbar();
  renderArticlePaneContent();
}

export function closeArticlePane() {
  const pane        = document.getElementById('article-pane');
  const listPanel   = document.getElementById('article-list-panel');
  const resizeHandle = document.getElementById('articlelist-resize');
  if (pane)         pane.style.display = 'none';
  if (listPanel)    listPanel.style.width = '100%';
  if (resizeHandle) resizeHandle.style.display = 'none';
}

// ── Article pane toolbar ──────────────────────────────────────────────────────
// Re-renders only the toolbar buttons (star/archive state, font label).
// Called from openArticlePane() and refreshAll().

export function renderArticlePaneToolbar() {
  const toolbar = document.getElementById('article-pane-toolbar');
  if (!toolbar || !state.selectedArticle) return;

  const a = state.selectedArticle;
  toolbar.innerHTML = `
    <button id="btn-close-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #e8e8e8; border: none; border-radius: 4px;">← Back</button>
    <div style="display: flex; gap: 8px; align-items: center;">
      <div style="display: flex; align-items: center; gap: 4px; background: #e8e8e8; border-radius: 4px; padding: 2px;">
        <button id="btn-font-decrease" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A-</button>
        <span id="font-size-label" style="font-size: 12px; color: #666; min-width: 35px; text-align: center;">${state.articleFontSize}px</span>
        <button id="btn-font-increase" style="padding: 4px 10px; font-size: 14px; cursor: pointer; background: transparent; border: none;">A+</button>
      </div>
      <button id="btn-star-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${a.isStarred ? '#ff9500' : '#e8e8e8'}; color: ${a.isStarred ? 'white' : '#333'}; border: none; border-radius: 4px;">
        ${a.isStarred ? '★ Starred' : '☆ Star'}
      </button>
      <button id="btn-archive-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: ${a.isArchived ? '#8e8e93' : '#e8e8e8'}; color: ${a.isArchived ? 'white' : '#333'}; border: none; border-radius: 4px;">
        ${a.isArchived ? '📦 Archived' : '📥 Archive'}
      </button>
      <button id="btn-share-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #34c759; color: white; border: none; border-radius: 4px;">📋 Share</button>
      <button id="btn-open-external" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #007aff; color: white; border: none; border-radius: 4px;">Open in Browser ↗</button>
      <button id="btn-add-note" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #9c27b0; color: white; border: none; border-radius: 4px;">📝 Add Note</button>
      <button id="btn-delete-article" style="padding: 6px 12px; font-size: 13px; cursor: pointer; background: #ff3b30; color: white; border: none; border-radius: 4px;">🗑️ Delete</button>
    </div>
  `;

  document.getElementById('btn-close-article').addEventListener('click', () => {
    state.selectedArticle = null;
    closeArticlePane();
    if (_onRefreshSidebar) _onRefreshSidebar();
    if (_onRefreshList)    _onRefreshList();
  });

  document.getElementById('btn-font-decrease').addEventListener('click', () => {
    if (state.articleFontSize > 12) {
      state.articleFontSize -= 2;
      const textEl = document.getElementById('article-text');
      if (textEl) textEl.style.fontSize = state.articleFontSize + 'px';
      const lbl = document.getElementById('font-size-label');
      if (lbl) lbl.textContent = state.articleFontSize + 'px';
    }
  });

  document.getElementById('btn-font-increase').addEventListener('click', () => {
    if (state.articleFontSize < 28) {
      state.articleFontSize += 2;
      const textEl = document.getElementById('article-text');
      if (textEl) textEl.style.fontSize = state.articleFontSize + 'px';
      const lbl = document.getElementById('font-size-label');
      if (lbl) lbl.textContent = state.articleFontSize + 'px';
    }
  });

  document.getElementById('btn-star-article').addEventListener('click', async () => {
    if (!state.selectedArticle) return;
    await toggleArticleStar(state.selectedArticle.id);
    state.selectedArticle = { ...state.selectedArticle, isStarred: !state.selectedArticle.isStarred };
    const btn = document.getElementById('btn-star-article');
    if (btn) {
      btn.style.background = state.selectedArticle.isStarred ? '#ff9500' : '#e8e8e8';
      btn.style.color      = state.selectedArticle.isStarred ? 'white'   : '#333';
      btn.textContent      = state.selectedArticle.isStarred ? '★ Starred' : '☆ Star';
    }
    if (_onRefreshSidebar) _onRefreshSidebar();
    if (_onRefreshList)    _onRefreshList();
  });

  document.getElementById('btn-archive-article').addEventListener('click', async () => {
    if (!state.selectedArticle) return;
    await toggleArticleArchive(state.selectedArticle.id);
    state.selectedArticle = { ...state.selectedArticle, isArchived: !state.selectedArticle.isArchived };
    const btn = document.getElementById('btn-archive-article');
    if (btn) {
      btn.style.background = state.selectedArticle.isArchived ? '#8e8e93' : '#e8e8e8';
      btn.style.color      = state.selectedArticle.isArchived ? 'white'   : '#333';
      btn.textContent      = state.selectedArticle.isArchived ? '📦 Archived' : '📥 Archive';
    }
    if (_onRefreshSidebar) _onRefreshSidebar();
    if (_onRefreshList)    _onRefreshList();
  });

  document.getElementById('btn-share-article').addEventListener('click', async () => {
    if (!state.selectedArticle) return;
    try {
      await navigator.clipboard.writeText(`${state.selectedArticle.title}\n${state.selectedArticle.url}`);
      const btn = document.getElementById('btn-share-article');
      if (btn) { btn.textContent = '✓ Copied!'; setTimeout(() => { btn.textContent = '📋 Share'; }, 2000); }
    } catch (err) { console.error('Share copy failed:', err); }
  });

  document.getElementById('btn-open-external').addEventListener('click', () => {
    if (state.selectedArticle) window.open(state.selectedArticle.url, '_blank');
  });

  document.getElementById('btn-add-note').addEventListener('click', () => {
    if (!state.selectedArticle) return;
    const highlightedText = window.getSelection().toString().trim();
    showAddNoteDialog(state.selectedArticle, highlightedText, () => {
      if (_onRefreshSidebar) _onRefreshSidebar();
      renderArticlePaneContent();
    });
  });

  document.getElementById('btn-delete-article').addEventListener('click', async () => {
    if (!state.selectedArticle) return;
    await deleteArticle(state.selectedArticle.id);
    state.selectedArticle = null;
    closeArticlePane();
    if (_onRefreshSidebar) _onRefreshSidebar();
    if (_onRefreshList)    _onRefreshList();
  });
}
