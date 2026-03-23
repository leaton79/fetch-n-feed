// views/dialogs.js — Overlay modal dialogs.
//
// renderApp is passed as a callback parameter rather than imported from main.js
// to keep the dependency graph acyclic (main → views, never views → main).

import { addFolder, getAllFeeds, getAllNoteTags, addNoteTag, addNote, updateNote } from '../feedManager.js';
import { stripHtml } from '../utils.js';

// ── Keyboard shortcuts overlay ────────────────────────────────────────────────

export function showKeyboardHelp() {
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

  document.getElementById('keyboard-help').addEventListener('click', (e) => {
    if (e.target.id === 'keyboard-help') {
      document.getElementById('keyboard-help').remove();
    }
  });
}

// ── New folder dialog ─────────────────────────────────────────────────────────

export function showFolderDialog(onDone) {
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
  const input  = document.getElementById('folder-name-input');

  input.focus();

  const closeDialog = () => dialog.remove();

  const createFolder = async () => {
    const name = input.value.trim();
    if (name) {
      await addFolder(name);
      closeDialog();
      onDone();
    }
  };

  document.getElementById('folder-dialog-cancel').addEventListener('click', closeDialog);
  document.getElementById('folder-dialog-create').addEventListener('click', createFolder);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  createFolder();
    if (e.key === 'Escape') closeDialog();
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}

// ── Edit note dialog ──────────────────────────────────────────────────────────

export function showEditNoteDialog(note, onDone) {
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

  const dialog    = document.getElementById('edit-note-dialog');
  const closeDialog = () => dialog.remove();

  document.getElementById('edit-note-cancel').addEventListener('click', closeDialog);

  document.getElementById('edit-note-save').addEventListener('click', async () => {
    const tagsInput = document.getElementById('edit-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);

    for (const tagName of tags) {
      const existing = getAllNoteTags().find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!existing) await addNoteTag(tagName);
    }

    await updateNote(note.id, {
      highlightedText: document.getElementById('edit-highlight').value,
      annotation:      document.getElementById('edit-annotation').value,
      tags,
      citationAuthor:  document.getElementById('edit-citation-author').value,
      citationDate:    document.getElementById('edit-citation-date').value,
      citationTitle:   document.getElementById('edit-citation-title').value,
      citationSource:  document.getElementById('edit-citation-source').value,
      citationUrl:     document.getElementById('edit-citation-url').value,
    });

    closeDialog();
    onDone();
  });

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}

// ── Add note dialog ───────────────────────────────────────────────────────────

export function showAddNoteDialog(article, highlightedText = '', onDone) {
  const feed     = getAllFeeds().find(f => f.id === article.feedId);
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

  const dialog    = document.getElementById('add-note-dialog');
  const closeDialog = () => dialog.remove();

  document.getElementById('add-note-cancel').addEventListener('click', closeDialog);

  document.getElementById('add-note-save').addEventListener('click', async () => {
    const highlightText = document.getElementById('new-highlight').value.trim();
    const annotation    = document.getElementById('new-annotation').value.trim();

    if (!highlightText && !annotation) {
      alert('Please add a highlight or annotation');
      return;
    }

    const tagsInput = document.getElementById('new-tags').value;
    const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);

    for (const tagName of tags) {
      const existing = getAllNoteTags().find(t => t.name.toLowerCase() === tagName.toLowerCase());
      if (!existing) await addNoteTag(tagName);
    }

    const feedForNote = getAllFeeds().find(f => f.id === article.feedId);

    await addNote({
      articleId:        article.id,
      articleTitle:     article.title,
      articleUrl:       article.url,
      articleAuthor:    document.getElementById('new-citation-author').value,
      articlePublishedAt: article.publishedAt,
      feedTitle:        feedForNote ? feedForNote.title : '',
      highlightedText:  highlightText,
      annotation,
      tags,
      citationAuthor:   document.getElementById('new-citation-author').value,
      citationDate:     document.getElementById('new-citation-date').value,
      citationTitle:    document.getElementById('new-citation-title').value,
      citationSource:   document.getElementById('new-citation-source').value,
      citationUrl:      document.getElementById('new-citation-url').value,
    });

    closeDialog();
    onDone();
  });

  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog();
  });
}
