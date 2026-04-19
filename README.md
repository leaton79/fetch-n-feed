# Fetch N Feed

**Notice:** This project was created with the assistance of GenAI tools. It should be carefully reviewed and independently inspected before being used in any production, security-sensitive, or otherwise critical context.

A fast, privacy-first RSS reader for macOS, built with [Tauri 2](https://tauri.app) and vanilla JavaScript. No accounts, no cloud sync, no tracking — your feeds and reading history live entirely on your machine.

![Platform](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-lightgrey)
![Tauri](https://img.shields.io/badge/Tauri-2.x-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Subscribe to any RSS / Atom feed** — paste a URL and go
- **Folders** — organise feeds into collapsible groups
- **Four view layouts** — List, Grid, Magazine, Inline
- **Full-text extraction** — fetches the complete article when the feed only provides a summary
- **Notes & highlights** — annotate passages, generate APA citations, export to text
- **Unread badges** — blue pill counts on each feed, bold title when unread items exist
- **Starred & Archived** filters
- **"Load more" pagination** — 75 articles per page, context-aware reset
- **Live refresh progress** — real-time counter while feeds update (`30 / 407 feeds · 34 new articles`)
- **Batched feed refresh** — 10 feeds per batch to avoid rate-limiting
- **Native HTTP fetching** — uses Rust's `reqwest` directly; no CORS proxy required
- **OPML import / export** — move your subscriptions in or out
- **🧹 Prune stale feeds** — one-click removal of feeds that haven't published in 18+ months, with a reviewable checklist before anything is deleted
- **Reading position persistence** — reopens to the feed and article you left on
- **Startup cleanup** — articles older than your retention window are removed automatically; starred, highlighted, and noted articles are always preserved
- **Keyboard shortcuts** — `j`/`k` or `Shift+↑↓` to navigate, `s` to star, `a` to archive, `r` to refresh, `Escape` to close, `?` for help
- **Resizable panels** — drag the sidebar and article-list dividers

---

## Installation (macOS Apple Silicon)

### Option A — Download the DMG

1. Go to [Releases](https://github.com/leaton79/fetch-n-feed/releases) and download `Fetch N Feed_x.x.x_aarch64.dmg`
2. Open the DMG, drag **Fetch N Feed.app** to `/Applications`
3. Launch from Spotlight or Launchpad

> **First launch:** macOS may show a security prompt because the app is not notarized. Right-click the app → **Open** → **Open** to allow it.

### Option B — Build from source

**Prerequisites:**
- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 18+
- Xcode Command Line Tools (`xcode-select --install`)

```bash
git clone https://github.com/leaton79/fetch-n-feed.git
cd fetch-n-feed
npm install
npm run tauri build
```

The built app and DMG are placed in:
```
src-tauri/target/release/bundle/macos/Fetch N Feed.app
src-tauri/target/release/bundle/dmg/Fetch N Feed_x.x.x_aarch64.dmg
```

### Development mode

```bash
npm run tauri dev
```

Hot-reload is active — save any file in `src/` and the app updates instantly.

---

## Windows / Linux

Tauri supports Windows and Linux builds. This project has been developed and tested exclusively on macOS Apple Silicon. Building for other platforms should work but is untested — contributions welcome.

---

## Architecture

```
src/
├── main.js              # Entry point: init, renderApp(), keyboard handler, scoped update helpers
├── state.js             # Shared mutable state object (no framework)
├── database.js          # IndexedDB wrapper with in-memory cache
├── feedManager.js       # Feed/article/note CRUD, refresh logic, stale-feed pruning
├── rssParser.js         # RSS/Atom XML parser + native Rust HTTP fetch
├── utils.js             # stripHtml, formatArticleContent, sortArticles, etc.
├── opml.js              # OPML import / export
└── views/
    ├── sidebar.js        # Feed list, folder list, refresh, prune
    ├── articleList.js    # List / Grid / Magazine / Inline layouts + click handlers
    ├── articlePane.js    # Article pane: toolbar, content, open/close, reading position
    ├── notesView.js      # Notes list, search, sort, export
    └── dialogs.js        # Modal overlays: folder, note, prune stale feeds, keyboard help

src-tauri/
├── src/lib.rs           # Tauri app setup + fetch_url Rust command
└── Cargo.toml           # Rust dependencies (tauri, reqwest, serde)
```

**Key design decisions:**

- **No framework** — vanilla ES modules throughout; the DOM is updated surgically rather than rebuilt on every action
- **`renderApp()` runs once** (on startup). All subsequent updates use scoped helpers (`refreshSidebar`, `refreshList`, `openArticlePane`, etc.) to avoid full DOM rebuilds
- **Native HTTP** — `reqwest` in Rust handles all feed fetches, bypassing browser CORS restrictions entirely and delivering full network speed across hundreds of feeds
- **IndexedDB + in-memory cache** — all data is stored locally; the cache makes reads synchronous after the initial load
- **Acyclic dependency graph** — `main → views → feedManager/database/utils`; views never import from `main`

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `Shift+↓` | Next article |
| `k` / `Shift+↑` | Previous article |
| `Enter` / `o` | Open article in browser |
| `s` | Star / unstar |
| `a` | Archive / unarchive |
| `r` | Refresh all feeds |
| `Escape` | Close article |
| `?` | Show keyboard help |

---

## Data & Privacy

All data — feeds, articles, notes, preferences — is stored in IndexedDB on your local machine. Nothing is sent to any server. Feed fetching goes directly from your Mac to the feed's origin server over native HTTP (no third-party proxy).

---

## License

MIT
