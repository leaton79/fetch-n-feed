// feedManager.js - Manage feeds and articles
import { fetchFeed } from './rssParser.js';
import { getData, updateData, generateId, now } from './database.js';

// ============ FEEDS ============

export async function addFeed(url, title) {
  const data = getData();
  
  const feed = {
    id: generateId(),
    title: title || url,
    url: url,
    tags: [],
    addedAt: now(),
    errorCount: 0,
    isEnabled: true,
  };
  
  await updateData({ feeds: [...data.feeds, feed] });
  return feed;
}

export async function updateFeed(id, updates) {
  const data = getData();
  const index = data.feeds.findIndex(f => f.id === id);
  
  if (index === -1) return null;
  
  const updatedFeed = { ...data.feeds[index], ...updates };
  const newFeeds = [...data.feeds];
  newFeeds[index] = updatedFeed;
  
  await updateData({ feeds: newFeeds });
  return updatedFeed;
}

export async function deleteFeed(id) {
  const data = getData();
  const newFeeds = data.feeds.filter(f => f.id !== id);
  
  if (newFeeds.length === data.feeds.length) return false;
  
  // Also delete all articles from this feed
  const newArticles = data.articles.filter(a => a.feedId !== id);
  
  await updateData({ feeds: newFeeds, articles: newArticles });
  return true;
}

export function getFeed(id) {
  return getData().feeds.find(f => f.id === id);
}

export function getAllFeeds() {
  return getData().feeds;
}

export function getFeedsByFolder(folderId) {
  return getData().feeds.filter(f => f.folderId === folderId);
}

export function getFeedsByTag(tagName) {
  return getData().feeds.filter(f => f.tags.includes(tagName));
}

// ============ ARTICLES ============

export async function addArticle(article) {
  const data = getData();
  
  const newArticle = {
    ...article,
    id: generateId(),
    fetchedAt: now(),
    isRead: false,
    isStarred: false,
    isArchived: false,
    engagementScore: 0,
    highlights: [],
    tags: [],
  };
  
  await updateData({ articles: [...data.articles, newArticle] });
  return newArticle;
}

export async function markArticleRead(id) {
  const data = getData();
  const index = data.articles.findIndex(a => a.id === id);
  
  if (index === -1) return;
  
  const newArticles = [...data.articles];
  newArticles[index] = {
    ...newArticles[index],
    isRead: true,
    readAt: now(),
  };
  
  await updateData({ articles: newArticles });
}

export async function markArticleUnread(id) {
  const data = getData();
  const index = data.articles.findIndex(a => a.id === id);
  
  if (index === -1) return;
  
  const newArticles = [...data.articles];
  newArticles[index] = {
    ...newArticles[index],
    isRead: false,
    readAt: undefined,
  };
  
  await updateData({ articles: newArticles });
}

export async function toggleArticleStar(id) {
  const data = getData();
  const index = data.articles.findIndex(a => a.id === id);
  
  if (index === -1) return false;
  
  const isNowStarred = !data.articles[index].isStarred;
  
  const newArticles = [...data.articles];
  newArticles[index] = {
    ...newArticles[index],
    isStarred: isNowStarred,
    starredAt: isNowStarred ? now() : undefined,
  };
  
  await updateData({ articles: newArticles });
  return isNowStarred;
}

export async function archiveArticle(id) {
  const data = getData();
  const index = data.articles.findIndex(a => a.id === id);
  
  if (index === -1) return;
  
  const newArticles = [...data.articles];
  newArticles[index] = {
    ...newArticles[index],
    isArchived: true,
  };
  
  await updateData({ articles: newArticles });
}

export async function toggleArticleArchive(id) {
  const data = getData();
  const index = data.articles.findIndex(a => a.id === id);
  
  if (index === -1) return false;
  
  const isNowArchived = !data.articles[index].isArchived;
  
  const newArticles = [...data.articles];
  newArticles[index] = {
    ...newArticles[index],
    isArchived: isNowArchived,
  };
  
  await updateData({ articles: newArticles });
  return isNowArchived;
}
export function getArticle(id) {
  return getData().articles.find(a => a.id === id);
}

export function getArticlesByFeed(feedId) {
  return getData().articles
    .filter(a => a.feedId === feedId && !a.isArchived)
    .sort((a, b) => (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt));
}

export function getAllArticles() {
  return getData().articles
    .filter(a => !a.isArchived)
    .sort((a, b) => (b.publishedAt || b.fetchedAt).localeCompare(a.publishedAt || a.fetchedAt));
}

export function getUnreadArticles() {
  return getAllArticles().filter(a => !a.isRead);
}

export function getStarredArticles() {
  return getData().articles
    .filter(a => a.isStarred)
    .sort((a, b) => (b.starredAt || '').localeCompare(a.starredAt || ''));
}

// ============ FOLDERS ============

export async function addFolder(name, parentId) {
  const data = getData();
  
  const folder = {
    id: generateId(),
    name,
    parentId,
    sortOrder: data.folders.length,
  };
  
  await updateData({ folders: [...data.folders, folder] });
  return folder;
}

export async function deleteFolder(id) {
  const data = getData();
  const newFolders = data.folders.filter(f => f.id !== id);
  
  if (newFolders.length === data.folders.length) return false;
  
  // Remove folder assignment from feeds (don't delete the feeds)
  const newFeeds = data.feeds.map(f => 
    f.folderId === id ? { ...f, folderId: undefined } : f
  );
  
  await updateData({ folders: newFolders, feeds: newFeeds });
  return true;
}

export function getAllFolders() {
  return getData().folders.sort((a, b) => a.sortOrder - b.sortOrder);
}

// ============ TAGS ============

export async function addTag(name, color) {
  const data = getData();
  
  // Check if tag already exists
  const existing = data.tags.find(t => t.name.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  
  const tag = {
    id: generateId(),
    name,
    color,
  };
  
  await updateData({ tags: [...data.tags, tag] });
  return tag;
}

export async function deleteTag(id) {
  const data = getData();
  const tagToDelete = data.tags.find(t => t.id === id);
  
  if (!tagToDelete) return false;
  
  const newTags = data.tags.filter(t => t.id !== id);
  
  // Remove tag from all feeds and articles
  const newFeeds = data.feeds.map(f => ({
    ...f,
    tags: f.tags.filter(t => t !== tagToDelete.name),
  }));
  
  const newArticles = data.articles.map(a => ({
    ...a,
    tags: a.tags.filter(t => t !== tagToDelete.name),
  }));
  
  await updateData({ tags: newTags, feeds: newFeeds, articles: newArticles });
  return true;
}

export function getAllTags() {
  return getData().tags;
}

// ============ CLEANUP ============

export async function cleanupOldArticles() {
  const data = getData();
  const retentionDays = data.preferences.articleRetentionDays;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  const cutoffString = cutoffDate.toISOString();
  
  const originalCount = data.articles.length;
  
  // Keep articles that are: starred, highlighted, or newer than cutoff
  const newArticles = data.articles.filter(a => 
    a.isStarred || 
    a.highlights.length > 0 || 
    a.fetchedAt > cutoffString
  );
  
  if (newArticles.length < originalCount) {
    await updateData({ articles: newArticles });
  }
  
  return originalCount - newArticles.length;
}
// ============ REFRESH ============

export async function refreshFeed(feedId, maxAgeDays = 7) {
  const data = getData();
  const feed = data.feeds.find(f => f.id === feedId);
  
  if (!feed) {
    return { success: false, error: 'Feed not found' };
  }
  
  const result = await fetchFeed(feed.url);
  
  if (!result.success) {
    await updateFeed(feedId, { 
      errorCount: feed.errorCount + 1,
      lastFetchedAt: now()
    });
    return { success: false, error: result.error };
  }
  
  // Update feed metadata
  await updateFeed(feedId, {
    title: feed.title === feed.url ? result.feed.title : feed.title,
    siteUrl: result.feed.siteUrl,
    description: result.feed.description,
    lastFetchedAt: now(),
    errorCount: 0,
  });
  
  // Calculate cutoff date
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);
  const cutoffString = cutoffDate.toISOString();
  
  // Get existing article URLs for this feed to avoid duplicates
  const existingUrls = new Set(
    data.articles.filter(a => a.feedId === feedId).map(a => a.url)
  );
  
  // Add new articles
  let newCount = 0;
  for (const item of result.feed.items) {
    if (!existingUrls.has(item.url)) {
      // Check if article is within our time window
      const articleDate = item.publishedAt || now();
      if (articleDate >= cutoffString) {
        await addArticle({
          feedId: feedId,
          title: item.title,
          url: item.url,
          author: item.author,
          summary: item.summary,
          content: item.content,
          publishedAt: item.publishedAt,
        });
        newCount++;
      }
    }
  }
  
  return { success: true, newArticles: newCount, totalItems: result.feed.items.length };
}

export async function refreshAllFeeds(maxAgeDays = 7) {
  const feeds = getAllFeeds().filter(f => f.isEnabled);
  const results = [];
  
  for (const feed of feeds) {
    const result = await refreshFeed(feed.id, maxAgeDays);
    results.push({ feedId: feed.id, title: feed.title, ...result });
  }
  
  return results;
}