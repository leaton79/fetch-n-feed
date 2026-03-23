import { addFeed, getAllFeeds, getAllArticles, deleteFeed, refreshAllFeeds, addFolder, deleteFolder, getAllFolders, updateFeed, refreshFeed } from '../feedManager.js';
import { getData } from '../database.js';
import { downloadOPML, parseOPML } from '../opml.js';
import { state } from '../state.js';
import { showFolderDialog, showPruneStaleDialog } from './dialogs.js';
import { renderArticles } from './articleList.js';

export function renderFeedsList(renderApp) {
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
      renderFeedsList(renderApp); renderArticles(renderApp);
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
        renderFeedsList(renderApp); renderArticles(renderApp);
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
          renderFeedsList(renderApp);
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

export async function handleAddFeed(renderApp) {
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
  renderFeedsList(renderApp); renderArticles(renderApp);
}

export function handlePruneStale(renderApp) {
  showPruneStaleDialog(18, (removed) => {
    const statusBar = document.getElementById('status-bar');
    if (statusBar) statusBar.textContent = `🧹 Removed ${removed} stale feed${removed !== 1 ? 's' : ''}`;
    renderFeedsList(renderApp);
    renderArticles(renderApp);
  });
}

export async function handleRefreshAll(renderApp, renderArticles) {
  const statusBar = document.getElementById('status-bar');
  const feeds = getAllFeeds();

  if (feeds.length === 0) {
    if (statusBar) statusBar.textContent = 'No feeds to refresh. Add a feed first!';
    return;
  }

  const maxAgeDays = parseInt(document.getElementById('fetch-age-select')?.value) || 7;

  // Disable the Refresh button while running so it can't be double-clicked
  const refreshBtn = document.getElementById('btn-refresh-all');
  if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.textContent = '↻ Refreshing…'; }
  if (statusBar) statusBar.textContent = `Starting refresh of ${feeds.length} feeds…`;

  try {
    const results = await refreshAllFeeds(maxAgeDays, (done, total, currentResults) => {
      const newSoFar = currentResults.reduce((sum, r) => sum + (r.newArticles || 0), 0);
      // Update status text — do this BEFORE renderArticles so it isn't overwritten
      if (statusBar) statusBar.textContent = `Refreshing… ${done} / ${total} feeds  ·  ${newSoFar} new articles`;
      // Silently skip the live update if the article list DOM has gone away
      try { renderArticles(renderApp); } catch (e) { console.warn('renderArticles in progress cb:', e); }
      // Restore status text in case renderArticles overwrote it
      if (statusBar) statusBar.textContent = `Refreshing… ${done} / ${total} feeds  ·  ${newSoFar} new articles`;
    });

    const totalNew = results.reduce((sum, r) => sum + (r.newArticles || 0), 0);
    const failures  = results.filter(r => !r.success).length;
    if (statusBar) statusBar.textContent = `✓ Refreshed ${results.length} feeds — ${totalNew} new articles${failures > 0 ? `  ·  ${failures} failed` : ''}`;
    renderArticles(renderApp);
  } catch (err) {
    console.error('handleRefreshAll failed:', err);
    if (statusBar) statusBar.textContent = `Refresh failed: ${err.message}`;
  } finally {
    // Always re-enable the button, even if something threw
    if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.textContent = '↻ Refresh'; }
  }
}
