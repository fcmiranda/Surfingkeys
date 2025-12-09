# OmniSearch Feature Documentation

## Overview

The `omniSearch` feature provides a unified search interface that aggregates results from multiple sources:
- **Open Tabs** - Currently open browser tabs
- **Bookmarks** - All bookmarks with full folder path context
- **Top Sites** - Most visited sites (if available)
- **History** - Browser history items

This creates a powerful "omnibox-like" experience where users can quickly find and navigate to any resource.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     omniSearch Request                       │
│                   (query, maxResults, etc.)                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              src/background/omniSearch.js                    │
│                  (Backend Search Module)                     │
├────────────────┬────────────────┬──────────────┬────────────┤
│   Tabs Query   │  Bookmarks     │  Top Sites   │  History   │
│   (chrome.tabs)│  (chrome.bm)   │  (chrome.ts) │  (chrome.h)│
└────────────────┴────────────────┴──────────────┴────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Processing & Filtering                     │
├─────────────────────────────────────────────────────────────┤
│  • MRU ordering for tabs                                     │
│  • Bookmark deduplication (tabs that are bookmarked)         │
│  • Fuzzy search on bookmarks (fuzzysort)                    │
│  • Regex filtering on tabs                                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Grouped Response                          │
│  { tabs, topSites, bookmarks, history }                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         src/content_scripts/ui/omnibar.js                    │
│               (OmniSearch UI Handler)                        │
│    Uses: src/content_scripts/ui/omnibarIcons.js             │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
src/
├── background/
│   ├── omniSearch.js          # Backend search logic module
│   └── start.js               # Imports and uses omniSearch
├── common/
│   └── utils.js               # Shared utilities (safeDecodeURI)
└── content_scripts/
    └── ui/
        ├── omnibar.js         # UI handler (imports omnibarIcons)
        └── omnibarIcons.js    # Icon helper functions module
```

## Implementation Steps

### Step 1: Add Dependency

Install the `fuzzysort` library for fuzzy search on bookmarks:

```bash
npm install fuzzysort --save
```

This library provides fast fuzzy searching with configurable thresholds.

### Step 2: Add Utility Functions

Add the `safeDecodeURI` helper to `src/common/utils.js`:

```javascript
/**
 * Safely decode a URI, returning the original string if decoding fails
 * @param {string} url - The URL to decode
 * @returns {string} The decoded URL or original if decoding fails
 */
function safeDecodeURI(url) {
    try {
        return decodeURI(url);
    } catch (e) {
        return url;
    }
}

// Export the function
export { safeDecodeURI };
```

### Step 3: Create the OmniSearch Backend Module

Create `src/background/omniSearch.js` with the search logic:

```javascript
/**
 * OmniSearch Module - Unified search across tabs, bookmarks, top sites, and history
 * @module omniSearch
 */

import fuzzysort from 'fuzzysort';
import { regexFromString, safeDecodeURI } from '../common/utils.js';

/** Default configuration for omniSearch */
const DEFAULT_CONFIG = {
    fuzzyThreshold: 0.5,
    fuzzyLimit: 100,
    maxBookmarksWithoutQuery: 100,
};

/**
 * Recursively extracts bookmarks from the bookmark tree with full folder path
 * @param {Array} tree - Chrome bookmark tree nodes
 * @param {string} parentTitle - Accumulated parent folder titles
 * @returns {{ bookmarksList: Array, bookmarksMap: Map }}
 */
export function getBookmarksWithFullPath(tree, parentTitle = '') {
    let bookmarksList = [];
    let bookmarksMap = new Map();

    for (const node of tree) {
        const isFolder = !node.url && node.children;
        
        if (isFolder) {
            const folderTitle = parentTitle ? `${parentTitle} - ${node.title}` : node.title;
            const { bookmarksList: childBookmarks, bookmarksMap: childMap } = 
                getBookmarksWithFullPath(node.children, folderTitle);
            bookmarksList = bookmarksList.concat(childBookmarks);
            bookmarksMap = new Map([...bookmarksMap, ...childMap]);
        } else {
            const bookmark = {
                ...node,
                fullPathTitle: parentTitle ? `${parentTitle} - ${node.title}` : node.title
            };
            bookmarksList.push(bookmark);
            bookmarksMap.set(node.url, bookmark);
        }
    }

    return { bookmarksList, bookmarksMap };
}

/**
 * Filters and orders tabs by Most Recently Used (MRU)
 * @param {Array} tabs - Array of tab objects
 * @param {Object} message - Message containing tabsThreshold
 * @param {Object} currentTab - The current active tab to exclude
 * @param {Object} config - Configuration object with tabsMRUOrder setting
 * @returns {Array} Filtered and ordered tabs
 */
export function filterAndOrderTabsByMRU(tabs, message, currentTab, config) {
    const { tabsMRUOrder, tabActivated = {} } = config;
    
    if (tabs.length > (message.tabsThreshold || 10) && tabsMRUOrder) {
        tabs = tabs.filter(t => t.id !== currentTab.id);
        
        tabs.sort((x, y) => {
            const a = x.lastAccessed || tabActivated[x.id];
            const b = y.lastAccessed || tabActivated[y.id];

            if (!isFinite(a) && !isFinite(b)) return 0;
            if (!isFinite(a)) return 1;
            if (!isFinite(b)) return -1;

            return b - a;
        });
    }
    return tabs;
}

/**
 * Factory function to create the omniSearch handler
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.conf - Configuration object
 * @param {Object} dependencies.tabActivated - Tab activation timestamps
 * @param {Function} dependencies._filterByTitleOrUrl - Filter function
 * @param {Function} dependencies._getHistory - History retrieval function
 * @param {Function} dependencies._response - Response handler function
 * @returns {Function} The omniSearch handler function
 */
export function createOmniSearch({ conf, tabActivated, _filterByTitleOrUrl, _getHistory, _response }) {
    return function omniSearch(message, sender, sendResponse) {
        const currentTab = sender.tab;
        const queryInfo = message.queryInfo || {};
        const query = message.query || '';
        const maxResults = message.maxResults || 100;

        chrome.tabs.query(queryInfo, function(tabs) {
            const config = { 
                tabsMRUOrder: conf.tabsMRUOrder, 
                tabActivated 
            };
            tabs = filterAndOrderTabsByMRU(tabs, message, currentTab, config);

            chrome.bookmarks.getTree(function(tree) {
                const { bookmarksMap } = getBookmarksWithFullPath(tree);

                // Filter tabs and annotate with bookmark info
                const filteredTabs = tabs.filter(tab => {
                    if (bookmarksMap.has(tab.url)) {
                        tab.bookmark = bookmarksMap.get(tab.url);
                        bookmarksMap.delete(tab.url);
                    }

                    if (query) {
                        const rxp = regexFromString(query, false, false);
                        return rxp.test(tab.title) || 
                               rxp.test(safeDecodeURI(tab.url)) || 
                               rxp.test(tab.bookmark?.fullPathTitle || '');
                    }
                    return true;
                });

                const remainingBookmarks = [...bookmarksMap.values()];

                // Get top sites (if API available)
                const getTopSitesPromise = new Promise(resolve => {
                    if (chrome.topSites) {
                        chrome.topSites.get(urls => resolve(_filterByTitleOrUrl(urls, query)));
                    } else {
                        resolve([]);
                    }
                });

                getTopSitesPromise.then(topSites => {
                    // Fuzzy search bookmarks
                    const fuzzyBookmarks = query 
                        ? fuzzysort.go(query, remainingBookmarks, { 
                            key: 'fullPathTitle', 
                            limit: DEFAULT_CONFIG.fuzzyLimit, 
                            threshold: DEFAULT_CONFIG.fuzzyThreshold 
                          }).map(result => result.obj)
                        : remainingBookmarks.slice(0, DEFAULT_CONFIG.maxBookmarksWithoutQuery);

                    const remainingSlots = Math.max(0, maxResults - 
                        (filteredTabs.length + topSites.length + fuzzyBookmarks.length));

                    if (remainingSlots > 0) {
                        _getHistory(query, remainingSlots, function(historyItems) {
                            _response(message, sendResponse, {
                                groupedUrls: { 
                                    tabs: filteredTabs, 
                                    topSites, 
                                    bookmarks: fuzzyBookmarks, 
                                    history: historyItems 
                                }
                            });
                        }, true);
                    } else {
                        _response(message, sendResponse, {
                            groupedUrls: { 
                                tabs: filteredTabs, 
                                topSites, 
                                bookmarks: fuzzyBookmarks, 
                                history: [] 
                            }
                        });
                    }
                });
            });
        });
    };
}
```

### Step 4: Create the Icon Helpers Module

Create `src/content_scripts/ui/omnibarIcons.js`:

```javascript
/**
 * Icon helper functions for omnibar prompts
 * Uses Material Symbols Outlined font
 * @module omnibarIcons
 */

/**
 * Creates an icon container with context and action icons
 * @param {string} contextIcon - Material symbol name for context
 * @param {string} actionIcon - Material symbol name for action (default: 'search')
 * @returns {string} HTML string
 */
export const fnPromptIndicatorHtml = (contextIcon, actionIcon = 'search') => 
    `<div class="icon-container">` +
        `<span class="material-symbols-outlined context-icon">${contextIcon}</span>` +
        `<span class="material-symbols-outlined action-icon">${actionIcon}</span>` +
    `</div>`;

/**
 * Creates an omni-style icon container with larger context icon
 * @param {string} contextIcon - Material symbol name for context
 * @param {string} actionIcon - Material symbol name for action (optional)
 * @returns {string} HTML string
 */
export const fnPromptOmni = (contextIcon, actionIcon = '') => 
    `<div class="icon-container">` +
        `<span class="material-symbols-outlined context-icon context-icon-omni">${contextIcon}</span>` +
        `<span class="material-symbols-outlined action-icon-omni action-icon">${actionIcon}</span>` +
    `</div>`;

/**
 * Triple-layered colorful bolt icon for OmniSearch prompt
 * @type {string}
 */
export const fnPromptBolt = 
    `<span class="prompt">` +
        `<span style="left: 10px;color: #72e0d1;font-size: 34px;" class="material-symbols-outlined">bolt</span>` +
        `<span style="left: 12px;position: absolute;color: #ed95d6;font-size: 29px;" class="material-symbols-outlined">bolt</span>` +
        `<span style="left: 14px;position: absolute;color: #f5d67b;font-size: 28px;" class="material-symbols-outlined">bolt</span>` +
    `</span>`;

/**
 * Wraps a material symbol icon name in a span element
 * @param {string} icon - Material symbol name
 * @returns {string} HTML string or empty if no icon
 */
export const fnIconHtml = icon => 
    icon ? `<span class="material-symbols-outlined">${icon}</span>` : '';
```

### Step 5: Update Background Script (start.js)

Import and use the omniSearch module:

```javascript
// At the top of the file, add imports
import { createOmniSearch } from './omniSearch.js';

// In the createBackend function, replace inline omniSearch with:
self.omniSearch = createOmniSearch({ 
    conf, 
    tabActivated, 
    _filterByTitleOrUrl, 
    _getHistory, 
    _response 
});
```

### Step 6: Update Omnibar (omnibar.js)

Import the icon helpers and use them:

```javascript
// At the top of the file
import {
    fnPromptIndicatorHtml,
    fnPromptOmni,
    fnPromptBolt,
    fnIconHtml,
} from './omnibarIcons.js';

// Register the OmniSearch handler
self.addHandler('OmniSearch', OpenURLs(fnPromptBolt, self, () => {
    return new Promise((resolve, reject) => {
        self.listBookmarkFolders(function() {
            RUNTIME('omniSearch', {
                maxResults: self.getHistoryCacheSize(),
                query: self.input.value
            }, function(response) {
                let results = [];
                if (response.groupedUrls) {
                    const { tabs, topSites, bookmarks, history } = response.groupedUrls;
                    results = [...tabs, ...topSites, ...bookmarks, ...history];
                } else if (response.urls) {
                    results = response.urls;
                }
                resolve(results);
            });
        });
    });
}));
``` 
                        key: 'fullPathTitle', 
                        limit: 100, 
                        threshold: 0.5 
                      }).map(result => result.obj)
                    : remainingBookmarks.slice(0, 100);

                const remainingSlots = Math.max(0, maxResults - 
                    (filteredTabs.length + topSites.length + fuzzyBookmarks.length));

                if (remainingSlots > 0) {
                    _getHistory(query, remainingSlots, function(historyItems) {
                        _response(message, sendResponse, {
                            groupedUrls: { tabs: filteredTabs, topSites, bookmarks: fuzzyBookmarks, history: historyItems }
                        });
                    }, true);
                } else {
                    _response(message, sendResponse, {
                        groupedUrls: { tabs: filteredTabs, topSites, bookmarks: fuzzyBookmarks, history: [] }
                    });
                }
            });
        });
    });
};
```

## Usage

Send a message to the background script with:

```javascript
chrome.runtime.sendMessage({
    action: 'omniSearch',
    query: 'search term',
    queryInfo: {},           // Optional: chrome.tabs.query parameters
    tabsThreshold: 10,       // Optional: Threshold for MRU ordering
    maxResults: 100,         // Optional: Maximum total results
    needResponse: true
}, function(response) {
    const { tabs, topSites, bookmarks, history } = response.groupedUrls;
    // Render results...
});
```

## Response Format

```javascript
{
    groupedUrls: {
        tabs: [
            {
                id: 123,
                title: "Tab Title",
                url: "https://example.com",
                bookmark: {  // Present if tab URL is bookmarked
                    id: "456",
                    title: "Bookmark Title",
                    fullPathTitle: "Folder - Subfolder - Bookmark Title"
                }
            }
        ],
        topSites: [
            { title: "Top Site", url: "https://popular.com" }
        ],
        bookmarks: [
            {
                id: "789",
                title: "Bookmark",
                url: "https://bookmarked.com",
                fullPathTitle: "Work - Projects - Bookmark"
            }
        ],
        history: [
            { 
                id: "h123", 
                title: "History Item", 
                url: "https://visited.com",
                visitCount: 42
            }
        ]
    }
}
```

## Key Features

1. **Modular Architecture**: Backend logic in `omniSearch.js`, UI helpers in `omnibarIcons.js`.

2. **Factory Pattern**: `createOmniSearch()` accepts dependencies for testability.

3. **Deduplication**: Tabs that are also bookmarked get the bookmark info attached, and the bookmark is removed from the separate bookmarks list to avoid duplicates.

4. **Fuzzy Search**: Bookmarks use `fuzzysort` library with `fullPathTitle` as the search key, allowing users to find bookmarks by folder path.

5. **MRU Ordering**: Tabs are sorted by most recently accessed when `tabsMRUOrder` config is enabled and tab count exceeds threshold.

6. **Grouped Results**: Results are returned in categories, allowing the UI to render them with different styling or sections.

7. **Result Limiting**: The `maxResults` parameter controls total results, with history filling remaining slots after other sources.

## Module Exports

### `src/background/omniSearch.js`

| Export | Type | Description |
|--------|------|-------------|
| `createOmniSearch` | Function | Factory that creates the omniSearch handler |
| `getBookmarksWithFullPath` | Function | Extracts bookmarks with full folder path |
| `filterAndOrderTabsByMRU` | Function | Orders tabs by most recently used |

### `src/content_scripts/ui/omnibarIcons.js`

| Export | Type | Description |
|--------|------|-------------|
| `fnPromptIndicatorHtml` | Function | Creates context+action icon pair |
| `fnPromptOmni` | Function | Creates omni-style icon container |
| `fnPromptBolt` | String | Triple-layered colorful bolt icon |
| `fnIconHtml` | Function | Wraps icon name in span element |

## Differences from Thunder-Keys Implementation

| Aspect | Thunder-Keys | SF-Master (Refactored) |
|--------|--------------|------------------------|
| Architecture | Inline in start.js | Separate module files |
| Pattern | Direct implementation | Factory pattern with DI |
| Icon helpers | Inline in omnibar.js | Separate omnibarIcons.js |
| Promise handling | Callback-based | Mixed Promises for cleaner flow |
| Tab ordering | Custom `tabActivated` only | Uses `lastAccessed` with fallback |
| Error handling | Minimal | `safeDecodeURI` for robustness |
| Documentation | Inline comments | JSDoc + separate docs |
| Testability | Difficult (closures) | Easy (dependency injection) |

## Testing

To test the omniSearch feature:

1. Open multiple tabs with various content
2. Add some bookmarks in nested folders
3. Call `omniSearch` with different query strings
4. Verify:
   - Tabs matching query appear in `tabs` array
   - Bookmarked tabs have `bookmark` property attached
   - Bookmarks use fuzzy matching on full path
   - History fills remaining result slots

### Unit Testing the Module

```javascript
import { createOmniSearch, getBookmarksWithFullPath, filterAndOrderTabsByMRU } from './omniSearch.js';

// Test getBookmarksWithFullPath
describe('getBookmarksWithFullPath', () => {
    it('should extract bookmarks with full path', () => {
        const tree = [{
            title: 'Folder',
            children: [{
                title: 'Bookmark',
                url: 'https://example.com'
            }]
        }];
        const { bookmarksList, bookmarksMap } = getBookmarksWithFullPath(tree);
        expect(bookmarksList[0].fullPathTitle).toBe('Folder - Bookmark');
        expect(bookmarksMap.has('https://example.com')).toBe(true);
    });
});

// Test with mock dependencies
describe('createOmniSearch', () => {
    it('should create a handler function', () => {
        const handler = createOmniSearch({
            conf: { tabsMRUOrder: true },
            tabActivated: {},
            _filterByTitleOrUrl: () => [],
            _getHistory: (q, l, cb) => cb([]),
            _response: (msg, send, data) => send(data)
        });
        expect(typeof handler).toBe('function');
    });
});
```

## How to Open OmniSearch

To trigger the OmniSearch omnibar from user scripts or commands:

```javascript
Front.openOmnibar({ type: 'OmniSearch' });
```

## CSS Styling (Optional)

Add these styles to support the icon-based prompts:

```css
.icon-container {
    display: inline-flex;
    align-items: center;
    gap: 4px;
}

.context-icon, .action-icon {
    font-size: 18px;
}

.context-icon-omni {
    font-size: 20px;
}

.action-icon-omni {
    font-size: 16px;
    opacity: 0.7;
}
```
