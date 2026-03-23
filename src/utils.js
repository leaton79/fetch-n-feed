// utils.js — Pure helpers shared across view modules.
// No DOM side-effects, no mutable shared state.

import { getAllNotes } from './feedManager.js';

// ── Color ────────────────────────────────────────────────────────────────────

export function getFeedColor(feedId) {
  const colors = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#5856d6', '#00c7be', '#ff2d55'];
  let hash = 0;
  for (let i = 0; i < feedId.length; i++) {
    hash = feedId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// ── Text helpers ─────────────────────────────────────────────────────────────

export function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

export function truncate(text, maxLength) {
  const clean = stripHtml(text).trim();
  if (clean.length <= maxLength) return clean;
  return clean.substring(0, maxLength).trim() + '...';
}

// ── Highlight ────────────────────────────────────────────────────────────────

export function applyHighlight(html, highlightText) {
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

// ── Article content formatter ─────────────────────────────────────────────────

export function formatArticleContent(content, articleId = null) {
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

// ── Sorting ───────────────────────────────────────────────────────────────────
// sortOrder is passed explicitly so this function stays pure (no hidden state).

export function sortArticles(articles, feeds, sortOrder) {
  const sorted = [...articles];

  switch (sortOrder) {
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
