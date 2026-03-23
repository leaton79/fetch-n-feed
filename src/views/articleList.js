import { getAllFeeds, getAllArticles, getArticlesByFeed, markArticleRead, deleteMultipleArticles } from '../feedManager.js';
import { getData } from '../database.js';
import { getFeedColor, stripHtml, truncate, formatArticleContent, sortArticles } from '../utils.js';
import { state, ARTICLES_PER_PAGE } from '../state.js';
import { selectArticle, extractArticle, renderArticlePaneContent, saveReadingPosition, openArticlePane } from './articlePane.js';
import { renderNotesView } from './notesView.js';

export function renderArticles(renderApp) {
  const container = document.getElementById('articles-list');
  const statusBar = document.getElementById('status-bar');

  // DOM not ready yet (e.g. called during early init) — bail silently
  if (!container) return;

  // Show notes view if active
  if (state.showNotesView) {
    renderNotesView(renderApp);
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
    case 'grid': renderGridLayout(container, pagedArticles, feeds, renderApp); break;
    case 'magazine': renderMagazineLayout(container, pagedArticles, feeds, renderApp); break;
    case 'inline': renderInlineLayout(container, pagedArticles, feeds, renderApp); break;
    default: renderListLayout(container, pagedArticles, feeds, renderApp);
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
      renderArticles(renderApp);
    });
  }

  // Restore scroll position if saved (e.g. after article selection)
  if (state.savedArticleListScroll > 0) {
    const articlesList = document.getElementById('articles-list');
    if (articlesList) articlesList.scrollTop = state.savedArticleListScroll;
  }
}

export function renderListLayout(container, articles, feeds, renderApp) {
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
  attachArticleClickHandlers(articles, renderApp);
}

export function renderGridLayout(container, articles, feeds, renderApp) {
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
  attachArticleClickHandlers(articles, renderApp);
}

export function renderMagazineLayout(container, articles, feeds, renderApp) {
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
  attachArticleClickHandlers(articles, renderApp);
}

export function renderInlineLayout(container, articles, feeds, renderApp) {
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
          renderArticles(renderApp);
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

export function attachArticleClickHandlers(articles, renderApp) {
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
        renderArticles(renderApp);
        return;
      }

      // Normal click - clear selection and open article
      state.selectedArticles.clear();

      // Preserve article list scroll position
      const articleList = document.getElementById('articles-list');
      state.savedArticleListScroll = articleList ? articleList.scrollTop : 0;

      await markArticleRead(articleId);
      state.selectedArticle = article;
      state.isLoadingArticle = true;

      // Show pane with loading spinner — no full renderApp() call needed
      openArticlePane();

      const textContent = stripHtml(article.content || '');
      const isTruncated = textContent.includes('Read the full story') || textContent.includes('Continue reading') || textContent.includes('Read more') || textContent.length < 500;
      if (!article.content || isTruncated) {
        const result = await extractArticle(article.url);
        if (result.success && result.content) state.selectedArticle = { ...article, content: result.content };
      }

      state.isLoadingArticle = false;
      // Swap in final content without touching the article list DOM
      renderArticlePaneContent();
      saveReadingPosition();
    });
  });
}
