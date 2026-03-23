// state.js — Single shared mutable state object for the app.
//
// Every module reads and writes properties on this object directly.
// Using a plain object (rather than individual `export let` bindings) means
// mutations from any module are immediately visible everywhere — ES module
// live bindings only work for the *exporting* module's own assignments.

export const state = {
  // Layout / UI
  sidebarWidth:        260,
  articleListWidth:    350,
  articleFontSize:     16,
  currentLayout:       'list',   // 'list' | 'grid' | 'magazine' | 'inline'

  // Navigation
  currentFeedId:       null,
  currentFolderId:     null,
  currentFilter:       'all',    // 'all' | 'unread' | 'starred' | 'archived'
  currentSort:         'newest',
  searchQuery:         '',
  feedSearchQuery:     '',
  fetchAgeDays:        7,

  // Article pane
  selectedArticle:     null,
  isLoadingArticle:    false,
  savedArticleListScroll: 0,

  // Multi-select
  selectedArticles:    new Set(),

  // Pagination
  articlesPage:        1,
  lastArticlesContext: '',

  // Notes view
  showNotesView:       false,
  notesSort:           'newest', // 'newest' | 'oldest' | 'publication' | 'tag'
  notesTagFilter:      null,
  selectedNotes:       new Set(),
  editingNote:         null,
  notesSearchQuery:    '',

  // Folders
  expandedFolders:     new Set(),
};

export const ARTICLES_PER_PAGE = 75;
