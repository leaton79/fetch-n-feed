import { getAllNotes, getAllNoteTags, deleteNote, deleteMultipleNotes, generateAPACitation, exportNotesToText, markArticleRead } from '../feedManager.js';
import { getData } from '../database.js';
import { stripHtml } from '../utils.js';
import { state } from '../state.js';
import { showEditNoteDialog } from './dialogs.js';

export function renderNotesView(renderApp) {
  const container = document.getElementById('articles-list');
  const statusBar = document.getElementById('status-bar');

  let notes = getAllNotes();
  const noteTags = getAllNoteTags();

  // Apply tag filter
  if (state.notesTagFilter) {
    notes = notes.filter(n => n.tags.includes(state.notesTagFilter));
  }

  // Apply search filter
  if (state.notesSearchQuery && state.notesSearchQuery.trim()) {
    const query = state.notesSearchQuery.toLowerCase().trim();
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
  switch (state.notesSort) {
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

  statusBar.textContent = `Notes — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}${state.notesTagFilter ? ` (filtered by: ${state.notesTagFilter})` : ''}`;

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
          <input type="text" id="notes-search-input" placeholder="🔍 Search notes..." value="${state.notesSearchQuery}"
            style="padding: 6px 12px; padding-right: 28px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; width: 150px; outline: none;">
          ${state.notesSearchQuery ? `<button id="btn-clear-notes-search" style="position: absolute; right: 6px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 14px; color: #999; padding: 0;">×</button>` : ''}
        </div>
        <label style="font-size: 12px; color: #666;">Sort:</label>
        <select id="notes-sort-select" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="newest" ${state.notesSort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest" ${state.notesSort === 'oldest' ? 'selected' : ''}>Oldest</option>
          <option value="publication" ${state.notesSort === 'publication' ? 'selected' : ''}>Publication</option>
          <option value="tag" ${state.notesSort === 'tag' ? 'selected' : ''}>Tag</option>
        </select>

        <label style="font-size: 12px; color: #666; margin-left: 8px;">Filter:</label>
        <select id="notes-tag-filter" style="padding: 4px 8px; font-size: 12px; border: 1px solid #d0d0d0; border-radius: 4px; background: white;">
          <option value="">All Tags</option>
          ${noteTags.map(t => `<option value="${t.name}" ${state.notesTagFilter === t.name ? 'selected' : ''}>${t.name}</option>`).join('')}
        </select>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 12px; color: #666;">${state.selectedNotes.size} selected</span>
        <button id="btn-export-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${state.selectedNotes.size > 0 ? '#007aff' : '#e8e8e8'}; color: ${state.selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${state.selectedNotes.size === 0 ? 'disabled' : ''}>
          Export Selected
        </button>
        <button id="btn-delete-selected" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: ${state.selectedNotes.size > 0 ? '#ff3b30' : '#e8e8e8'}; color: ${state.selectedNotes.size > 0 ? 'white' : '#999'}; border: none; border-radius: 4px;" ${state.selectedNotes.size === 0 ? 'disabled' : ''}>
          Delete Selected
        </button>
        <button id="btn-select-all-notes" style="padding: 6px 12px; font-size: 12px; cursor: pointer; background: #e8e8e8; color: #333; border: none; border-radius: 4px;">
          ${state.selectedNotes.size === notes.length ? 'Deselect All' : 'Select All'}
        </button>
      </div>
    </div>
  `;

  notes.forEach(note => {
    const isSelected = state.selectedNotes.has(note.id);
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
    state.notesSearchQuery = e.target.value;
    const cursorPos = e.target.selectionStart;
    renderNotesView(renderApp);
    // Restore focus and cursor position
    const newInput = document.getElementById('notes-search-input');
    newInput.focus();
    newInput.setSelectionRange(cursorPos, cursorPos);
  });

  document.getElementById('notes-search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.notesSearchQuery = '';
      e.target.value = '';
      renderNotesView(renderApp);
    }
  });

  const clearNotesSearchBtn = document.getElementById('btn-clear-notes-search');
  if (clearNotesSearchBtn) {
    clearNotesSearchBtn.addEventListener('click', () => {
      state.notesSearchQuery = '';
      renderNotesView(renderApp);
    });
  }

  document.getElementById('notes-sort-select').addEventListener('change', (e) => {
    state.notesSort = e.target.value;
    renderNotesView(renderApp);
  });

  document.getElementById('notes-tag-filter').addEventListener('change', (e) => {
    state.notesTagFilter = e.target.value || null;
    state.selectedNotes.clear();
    renderNotesView(renderApp);
  });

  document.getElementById('btn-select-all-notes').addEventListener('click', () => {
    if (state.selectedNotes.size === notes.length) {
      state.selectedNotes.clear();
    } else {
      notes.forEach(n => state.selectedNotes.add(n.id));
    }
    renderNotesView(renderApp);
  });

  document.getElementById('btn-export-selected').addEventListener('click', () => {
    if (state.selectedNotes.size === 0) return;
    const notesToExport = notes.filter(n => state.selectedNotes.has(n.id));
    downloadNotesAsText(notesToExport);
  });

  document.getElementById('btn-delete-selected').addEventListener('click', async () => {
    if (state.selectedNotes.size === 0) return;
    await deleteMultipleNotes(Array.from(state.selectedNotes));
    state.selectedNotes.clear();
    renderApp();
  });

  document.querySelectorAll('.note-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const noteId = e.target.dataset.noteId;
      if (e.target.checked) {
        state.selectedNotes.add(noteId);
      } else {
        state.selectedNotes.delete(noteId);
      }
      renderNotesView(renderApp);
    });
  });

  document.querySelectorAll('.btn-edit-note').forEach(btn => {
    btn.addEventListener('click', () => {
      const noteId = btn.dataset.noteId;
      const note = notes.find(n => n.id === noteId);
      if (note) showEditNoteDialog(note, renderApp);
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
        state.showNotesView = false;
        state.currentFeedId = null;
        state.currentFolderId = null;
        state.selectedArticle = article;
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

export function downloadNotesAsText(notes) {
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
