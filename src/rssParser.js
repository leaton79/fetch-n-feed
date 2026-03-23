// rssParser.js - Fetch and parse RSS feeds (browser-compatible)

// Parse RSS/Atom XML into a standard format
function parseXML(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid XML');
  }
  
  // Try RSS 2.0 format
  const channel = doc.querySelector('channel');
  if (channel) {
    return parseRSS(doc, channel);
  }
  
  // Try Atom format
  const atomFeed = doc.querySelector('feed');
  if (atomFeed) {
    return parseAtom(doc, atomFeed);
  }
  
  throw new Error('Unknown feed format');
}

function parseRSS(doc, channel) {
  const items = channel.querySelectorAll('item');
  
  return {
    title: getTextContent(channel, 'title') || 'Untitled Feed',
    description: getTextContent(channel, 'description') || '',
    siteUrl: getTextContent(channel, 'link') || '',
    items: Array.from(items).map(item => ({
      title: getTextContent(item, 'title') || 'Untitled',
      url: getTextContent(item, 'link') || '',
      author: getTextContent(item, 'dc\\:creator') || getTextContent(item, 'creator') || getTextContent(item, 'author') || '',
      summary: getTextContent(item, 'description') || '',
      content: getTextContent(item, 'content\\:encoded') || getTextContent(item, 'encoded') || getTextContent(item, 'description') || '',
      publishedAt: parseDate(getTextContent(item, 'pubDate')) || null,
    })),
  };
}

function parseAtom(doc, feed) {
  const entries = feed.querySelectorAll('entry');
  
  return {
    title: getTextContent(feed, 'title') || 'Untitled Feed',
    description: getTextContent(feed, 'subtitle') || '',
    siteUrl: getAtomLink(feed, 'alternate') || '',
    items: Array.from(entries).map(entry => ({
      title: getTextContent(entry, 'title') || 'Untitled',
      url: getAtomLink(entry, 'alternate') || getAtomLink(entry) || '',
      author: getTextContent(entry.querySelector('author'), 'name') || '',
      summary: getTextContent(entry, 'summary') || '',
      content: getTextContent(entry, 'content') || getTextContent(entry, 'summary') || '',
      publishedAt: parseDate(getTextContent(entry, 'published') || getTextContent(entry, 'updated')) || null,
    })),
  };
}

function getTextContent(parent, selector) {
  if (!parent) return '';
  const el = parent.querySelector(selector);
  return el ? el.textContent.trim() : '';
}

function getAtomLink(parent, rel) {
  if (!parent) return '';
  const links = parent.querySelectorAll('link');
  for (const link of links) {
    if (!rel || link.getAttribute('rel') === rel || (!link.getAttribute('rel') && rel === 'alternate')) {
      return link.getAttribute('href') || '';
    }
  }
  return '';
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

// Fetch and parse an RSS feed
// CORS proxy chain — tried in order until one succeeds.
// codetabs is first because corsproxy.io returns 403.
// allorigins.win removed — confirmed timing out on every request.
const PROXY_BUILDERS = [
  u => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => u, // direct fetch — last resort (works for feeds with CORS headers)
];

// 5 s per proxy attempt keeps worst-case at ~10 s/feed (codetabs timeout +
// instant corsproxy 403 + instant direct fail) instead of the old 36 s.
const PROXY_TIMEOUT_MS = 5000;

export async function fetchFeed(url) {
  let lastError = 'All proxies failed';

  for (const buildProxy of PROXY_BUILDERS) {
    try {
      const proxyUrl = buildProxy(url);
      const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(PROXY_TIMEOUT_MS) });

      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue; // try next proxy
      }

      const xmlText = await response.text();
      const feed = parseXML(xmlText);

      return { success: true, feed };
    } catch (err) {
      lastError = err.message || 'Fetch error';
      // AbortError = timeout; TypeError = network; continue to next proxy
    }
  }

  console.error('fetchFeed: all proxies failed for', url, '—', lastError);
  return { success: false, error: lastError };
}

// Detect RSS feed URLs from a website URL (basic detection)
export function possibleFeedUrls(siteUrl) {
  const base = siteUrl.replace(/\/$/, '');
  return [
    `${base}/feed`,
    `${base}/feed.xml`,
    `${base}/rss`,
    `${base}/rss.xml`,
    `${base}/atom.xml`,
    `${base}/index.xml`,
  ];
}

// Try to find a working feed URL for a website
export async function discoverFeed(siteUrl) {
  const urls = possibleFeedUrls(siteUrl);
  
  for (const url of urls) {
    const result = await fetchFeed(url);
    if (result.success) {
      return { success: true, feedUrl: url, feed: result.feed };
    }
  }
  
  return { success: false, error: 'No feed found at common locations' };
}