// opml.js - Import and export OPML files

// Export feeds to OPML format
export function exportToOPML(feeds) {
  const date = new Date().toUTCString();
  
  let opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>Fetch N Feed Subscriptions</title>
    <dateCreated>${date}</dateCreated>
  </head>
  <body>
`;

  feeds.forEach(feed => {
    const title = escapeXml(feed.title || feed.url);
    const xmlUrl = escapeXml(feed.url);
    const htmlUrl = escapeXml(feed.siteUrl || '');
    
    opml += `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${xmlUrl}"${htmlUrl ? ` htmlUrl="${htmlUrl}"` : ''}/>\n`;
  });

  opml += `  </body>
</opml>`;

  return opml;
}

// Parse OPML and return array of feed objects
export function parseOPML(opmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(opmlText, 'text/xml');
  
  // Check for parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Invalid OPML file');
  }
  
  const feeds = [];
  const outlines = doc.querySelectorAll('outline[xmlUrl], outline[xmlurl]');
  
  outlines.forEach(outline => {
    const xmlUrl = outline.getAttribute('xmlUrl') || outline.getAttribute('xmlurl');
    const title = outline.getAttribute('title') || outline.getAttribute('text') || xmlUrl;
    const htmlUrl = outline.getAttribute('htmlUrl') || outline.getAttribute('htmlurl') || '';
    
    if (xmlUrl) {
      feeds.push({
        title: title,
        url: xmlUrl,
        siteUrl: htmlUrl,
      });
    }
  });
  
  return feeds;
}

// Helper to escape XML special characters
function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Download OPML file
export function downloadOPML(feeds) {
  const opml = exportToOPML(feeds);
  const blob = new Blob([opml], { type: 'text/xml' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `fetch-n-feed-subscriptions-${new Date().toISOString().split('T')[0]}.opml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}