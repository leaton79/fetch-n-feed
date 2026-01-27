// articleExtractor.js - Extract full article content from web pages

// Fetch and extract full article content from a URL
export async function extractArticle(url) {
  try {
    // Use CORS proxy to fetch the page
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // Extract the article content
    const content = extractContent(doc);
    const title = extractTitle(doc);
    const author = extractAuthor(doc);
    const publishedDate = extractDate(doc);
    
    return {
      success: true,
      article: {
        title: title,
        author: author,
        publishedAt: publishedDate,
        content: content,
        url: url,
      }
    };
  } catch (error) {
    console.error('Failed to extract article:', url, error);
    return {
      success: false,
      error: error.message || 'Failed to extract article',
    };
  }
}

// Extract the main content from the page
function extractContent(doc) {
  // Remove unwanted elements
  const selectorsToRemove = [
    'script', 'style', 'nav', 'header', 'footer', 'aside',
    '.sidebar', '.navigation', '.menu', '.comments', '.comment',
    '.advertisement', '.ad', '.ads', '.social', '.share',
    '.related', '.recommended', '#comments', '.footer', '.header',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]'
  ];
  
  selectorsToRemove.forEach(selector => {
    doc.querySelectorAll(selector).forEach(el => el.remove());
  });
  
  // Try to find the main content using common selectors
  const contentSelectors = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '.post-body',
    '.article-body',
    '.story-body',
    '#article-body',
    '.blog-post',
    '.post',
  ];
  
  let contentElement = null;
  
  for (const selector of contentSelectors) {
    contentElement = doc.querySelector(selector);
    if (contentElement && contentElement.textContent.trim().length > 200) {
      break;
    }
  }
  
  // Fallback to body if no content container found
  if (!contentElement) {
    contentElement = doc.body;
  }
  
  if (!contentElement) {
    return '';
  }
  
  // Clean and format the content
  return cleanContent(contentElement);
}

// Clean the extracted content
function cleanContent(element) {
  // Clone to avoid modifying original
  const clone = element.cloneNode(true);
  
  // Remove remaining unwanted elements
  clone.querySelectorAll('script, style, iframe, form, input, button').forEach(el => el.remove());
  
  // Get paragraphs and headings
  const blocks = clone.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote');
  
  if (blocks.length > 0) {
    // Build content from meaningful blocks
    let content = '';
    blocks.forEach(block => {
      const text = block.textContent.trim();
      if (text.length > 20) { // Skip very short blocks
        const tagName = block.tagName.toLowerCase();
        if (tagName.startsWith('h')) {
          content += `\n\n## ${text}\n\n`;
        } else if (tagName === 'blockquote') {
          content += `\n> ${text}\n`;
        } else if (tagName === 'li') {
          content += `• ${text}\n`;
        } else {
          content += `${text}\n\n`;
        }
      }
    });
    return content.trim();
  }
  
  // Fallback to full text content
  return clone.textContent.trim().replace(/\s+/g, ' ').substring(0, 10000);
}

// Extract the article title
function extractTitle(doc) {
  // Try Open Graph title first
  const ogTitle = doc.querySelector('meta[property="og:title"]');
  if (ogTitle) return ogTitle.getAttribute('content');
  
  // Try Twitter title
  const twitterTitle = doc.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) return twitterTitle.getAttribute('content');
  
  // Try article headline
  const headline = doc.querySelector('h1.headline, h1.title, .article-title, .post-title');
  if (headline) return headline.textContent.trim();
  
  // Try first h1
  const h1 = doc.querySelector('h1');
  if (h1) return h1.textContent.trim();
  
  // Fallback to document title
  return doc.title || '';
}

// Extract the author
function extractAuthor(doc) {
  // Try meta tags
  const authorMeta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
  if (authorMeta) return authorMeta.getAttribute('content');
  
  // Try common author selectors
  const authorSelectors = [
    '.author-name', '.author', '.byline', '.by-author',
    '[rel="author"]', '.post-author', '.article-author'
  ];
  
  for (const selector of authorSelectors) {
    const el = doc.querySelector(selector);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length < 100) return text;
    }
  }
  
  return '';
}

// Extract the publication date
function extractDate(doc) {
  // Try meta tags
  const dateMeta = doc.querySelector(
    'meta[property="article:published_time"], meta[name="date"], meta[name="pubdate"]'
  );
  if (dateMeta) {
    const date = new Date(dateMeta.getAttribute('content'));
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  
  // Try time element
  const timeEl = doc.querySelector('time[datetime]');
  if (timeEl) {
    const date = new Date(timeEl.getAttribute('datetime'));
    if (!isNaN(date.getTime())) return date.toISOString();
  }
  
  return null;
}