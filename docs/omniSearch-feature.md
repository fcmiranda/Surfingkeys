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
│                    Data Collection Layer                     │
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

### Step 3: Update Imports in Background Script

Update `src/background/start.js` to import the new utilities:

```javascript
import {
    filterByTitleOrUrl,
    regexFromString,
    safeDecodeURI,
} from '../common/utils.js';
import fuzzysort from 'fuzzysort';
```

### Step 4: Add Helper Functions

#### `getBookmarksWithFullPath(tree, parentTitle)`

Recursively traverses the bookmark tree and creates:
- `bookmarksList`: Array of all bookmarks with `fullPathTitle` property
- `bookmarksMap`: Map keyed by URL for O(1) lookups

```javascript
function getBookmarksWithFullPath(tree, parentTitle = '') {
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
```

#### `filterAndOrderTabsByMRU(tabs, message, currentTab)`

Applies Most Recently Used (MRU) ordering to tabs when enabled:

```javascript
function filterAndOrderTabsByMRU(tabs, message, currentTab) {
    if (tabs.length > message.tabsThreshold && conf.tabsMRUOrder) {
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
```

### Step 5: Implement `omniSearch` Method

The main search method that orchestrates all data sources:

```javascript
self.omniSearch = function(message, sender, sendResponse) {
    const currentTab = sender.tab;
    const queryInfo = message.queryInfo || {};
    const query = message.query || '';
    const maxResults = message.maxResults || 100;

    chrome.tabs.query(queryInfo, function(tabs) {
        tabs = filterAndOrderTabsByMRU(tabs, message, currentTab);

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

            // Get top sites
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

1. **Deduplication**: Tabs that are also bookmarked get the bookmark info attached, and the bookmark is removed from the separate bookmarks list to avoid duplicates.

2. **Fuzzy Search**: Bookmarks use `fuzzysort` library with `fullPathTitle` as the search key, allowing users to find bookmarks by folder path.

3. **MRU Ordering**: Tabs are sorted by most recently accessed when `tabsMRUOrder` config is enabled and tab count exceeds threshold.

4. **Grouped Results**: Results are returned in categories, allowing the UI to render them with different styling or sections.

5. **Result Limiting**: The `maxResults` parameter controls total results, with history filling remaining slots after other sources.

## Differences from Thunder-Keys Implementation

| Aspect | Thunder-Keys | SF-Master (Refactored) |
|--------|--------------|------------------------|
| Promise handling | Callback-based | Mixed Promises for cleaner flow |
| Tab ordering | Custom `tabActivated` only | Uses `lastAccessed` with fallback |
| Code style | Nested callbacks | Cleaner async patterns |
| Error handling | Minimal | `safeDecodeURI` for robustness |
| Documentation | Inline comments | JSDoc + separate docs |

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
