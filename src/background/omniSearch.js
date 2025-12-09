/**
 * OmniSearch Module
 * 
 * Provides unified search functionality across multiple browser data sources:
 * - Open tabs (with MRU ordering)
 * - Bookmarks (with fuzzy search on full folder paths)
 * - Top sites
 * - Browser history
 * 
 * @module omniSearch
 */

import fuzzysort from 'fuzzysort';
import { regexFromString, safeDecodeURI } from '../common/utils.js';

/**
 * Default configuration for OmniSearch
 */
const DEFAULT_CONFIG = {
    maxResults: 100,
    fuzzySearchLimit: 100,
    fuzzySearchThreshold: 0.5
};

/**
 * Recursively extracts bookmarks from the bookmark tree with concatenated folder paths.
 * Creates both a flat list and a URL-keyed map for efficient lookups.
 * 
 * @param {Array} tree - The bookmark tree nodes from chrome.bookmarks.getTree()
 * @param {string} parentTitle - The accumulated parent folder path (used in recursion)
 * @returns {Object} Contains:
 *   - bookmarksList: Array of bookmarks with fullPathTitle property
 *   - bookmarksMap: Map keyed by URL for O(1) lookups
 * 
 * @example
 * const { bookmarksList, bookmarksMap } = getBookmarksWithFullPath(tree);
 * // bookmarksList[0].fullPathTitle = "Work - Projects - My Bookmark"
 */
function getBookmarksWithFullPath(tree, parentTitle = '') {
    let bookmarksList = [];
    let bookmarksMap = new Map();

    for (const node of tree) {
        const isFolder = !node.url && node.children;
        
        if (isFolder) {
            const folderTitle = parentTitle 
                ? `${parentTitle} - ${node.title}` 
                : node.title;
            
            const { bookmarksList: childBookmarks, bookmarksMap: childMap } = 
                getBookmarksWithFullPath(node.children, folderTitle);
            
            bookmarksList = bookmarksList.concat(childBookmarks);
            bookmarksMap = new Map([...bookmarksMap, ...childMap]);
        } else if (node.url) {
            const bookmark = {
                ...node,
                fullPathTitle: parentTitle 
                    ? `${parentTitle} - ${node.title}` 
                    : node.title
            };
            bookmarksList.push(bookmark);
            bookmarksMap.set(node.url, bookmark);
        }
    }

    return { bookmarksList, bookmarksMap };
}

/**
 * Filters and orders tabs by Most Recently Used (MRU) if enabled in config.
 * Removes the current tab from results when MRU ordering is active.
 * 
 * @param {Array} tabs - Array of tab objects from chrome.tabs.query()
 * @param {Object} options - Configuration options
 * @param {number} options.tabsThreshold - Minimum tabs to trigger MRU ordering
 * @param {boolean} options.mruEnabled - Whether MRU ordering is enabled
 * @param {Object} options.currentTab - The current active tab to exclude
 * @param {Object} options.tabActivated - Map of tabId -> last activated timestamp
 * @returns {Array} Filtered and sorted tabs
 */
function filterAndOrderTabsByMRU(tabs, { tabsThreshold, mruEnabled, currentTab, tabActivated }) {
    if (!mruEnabled || tabs.length <= tabsThreshold) {
        return tabs;
    }

    // Remove current tab when MRU ordering is enabled
    const filteredTabs = tabs.filter(t => t.id !== currentTab?.id);
    
    return filteredTabs.sort((x, y) => {
        const a = x.lastAccessed || tabActivated?.[x.id];
        const b = y.lastAccessed || tabActivated?.[y.id];

        if (!isFinite(a) && !isFinite(b)) return 0;
        if (!isFinite(a)) return 1;
        if (!isFinite(b)) return -1;

        return b - a;
    });
}

/**
 * Filters tabs based on query string matching title, URL, or bookmark path.
 * Also annotates tabs with bookmark information if the URL is bookmarked.
 * 
 * @param {Array} tabs - Array of tab objects
 * @param {Map} bookmarksMap - Map of URL -> bookmark object
 * @param {string} query - Search query string
 * @returns {Array} Filtered tabs with bookmark annotations
 */
function filterTabsWithBookmarkAnnotation(tabs, bookmarksMap, query) {
    return tabs.filter(tab => {
        // Attach bookmark info to tab if URL matches
        if (bookmarksMap.has(tab.url)) {
            tab.bookmark = bookmarksMap.get(tab.url);
            bookmarksMap.delete(tab.url); // Remove to avoid duplicates in bookmark results
        }

        if (!query) {
            return true;
        }

        const rxp = regexFromString(query, false, false);
        return rxp.test(tab.title) || 
               rxp.test(safeDecodeURI(tab.url)) || 
               rxp.test(tab.bookmark?.fullPathTitle || '');
    });
}

/**
 * Performs fuzzy search on bookmarks using their full folder path.
 * 
 * @param {Array} bookmarks - Array of bookmark objects with fullPathTitle
 * @param {string} query - Search query
 * @param {Object} options - Fuzzy search options
 * @param {number} options.limit - Maximum results to return
 * @param {number} options.threshold - Minimum match score (0-1)
 * @returns {Array} Matched bookmarks sorted by relevance
 */
function fuzzySearchBookmarks(bookmarks, query, { limit = 100, threshold = 0.5 } = {}) {
    if (!query) {
        return bookmarks.slice(0, limit);
    }

    return fuzzysort
        .go(query, bookmarks, { key: 'fullPathTitle', limit, threshold })
        .map(result => result.obj);
}

/**
 * Creates the OmniSearch handler for the background script.
 * This factory function captures the necessary dependencies.
 * 
 * @param {Object} dependencies - Required dependencies
 * @param {Object} dependencies.conf - Configuration object with tabsMRUOrder
 * @param {Object} dependencies.tabActivated - Map of tab activation timestamps
 * @param {Function} dependencies._filterByTitleOrUrl - Filter function for URLs
 * @param {Function} dependencies._getHistory - History retrieval function
 * @param {Function} dependencies._response - Response sender function
 * @returns {Function} The omniSearch message handler
 */
function createOmniSearchHandler({ conf, tabActivated, _filterByTitleOrUrl, _getHistory, _response }) {
    
    /**
     * Unified search across tabs, bookmarks, top sites, and history.
     * Returns grouped results for flexible UI rendering.
     * 
     * @param {Object} message - The message object
     * @param {string} message.query - Search query string
     * @param {number} message.maxResults - Maximum total results
     * @param {number} message.tabsThreshold - Threshold for MRU tab ordering
     * @param {Object} message.queryInfo - Chrome tabs query parameters
     * @param {Object} sender - The message sender
     * @param {Function} sendResponse - Response callback
     */
    return function omniSearch(message, sender, sendResponse) {
        const currentTab = sender.tab;
        const queryInfo = message.queryInfo || {};
        const query = message.query || '';
        const maxResults = message.maxResults || DEFAULT_CONFIG.maxResults;

        // Step 1: Get all tabs
        chrome.tabs.query(queryInfo, function(tabs) {
            const orderedTabs = filterAndOrderTabsByMRU(tabs, {
                tabsThreshold: message.tabsThreshold || 0,
                mruEnabled: conf.tabsMRUOrder,
                currentTab,
                tabActivated
            });

            // Step 2: Get bookmarks tree
            chrome.bookmarks.getTree(function(tree) {
                const { bookmarksMap } = getBookmarksWithFullPath(tree);

                // Step 3: Filter tabs and annotate with bookmark info
                const filteredTabs = filterTabsWithBookmarkAnnotation(
                    orderedTabs, 
                    bookmarksMap, 
                    query
                );

                // Get remaining bookmarks (not already open as tabs)
                const remainingBookmarks = [...bookmarksMap.values()];

                // Step 4: Get top sites
                const getTopSitesPromise = new Promise(resolve => {
                    if (chrome.topSites) {
                        chrome.topSites.get(urls => {
                            resolve(_filterByTitleOrUrl(urls, query));
                        });
                    } else {
                        resolve([]);
                    }
                });

                getTopSitesPromise.then(topSites => {
                    // Step 5: Fuzzy search bookmarks
                    const fuzzyBookmarks = fuzzySearchBookmarks(
                        remainingBookmarks, 
                        query,
                        {
                            limit: DEFAULT_CONFIG.fuzzySearchLimit,
                            threshold: DEFAULT_CONFIG.fuzzySearchThreshold
                        }
                    );

                    // Step 6: Calculate remaining slots for history
                    const currentResultCount = filteredTabs.length + topSites.length + fuzzyBookmarks.length;
                    const remainingSlots = Math.max(0, maxResults - currentResultCount);

                    // Step 7: Build and send response
                    const buildResponse = (historyItems = []) => ({
                        groupedUrls: {
                            tabs: filteredTabs,
                            topSites,
                            bookmarks: fuzzyBookmarks,
                            history: historyItems
                        }
                    });

                    if (remainingSlots > 0) {
                        _getHistory(query, remainingSlots, function(historyItems) {
                            _response(message, sendResponse, buildResponse(historyItems));
                        }, true);
                    } else {
                        _response(message, sendResponse, buildResponse());
                    }
                });
            });
        });
    };
}

export {
    createOmniSearchHandler,
    getBookmarksWithFullPath,
    filterAndOrderTabsByMRU,
    filterTabsWithBookmarkAnnotation,
    fuzzySearchBookmarks,
    DEFAULT_CONFIG
};
