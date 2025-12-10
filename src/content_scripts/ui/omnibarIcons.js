/**
 * Omnibar Icon Helpers Module
 * 
 * Provides icon-related utility functions for rendering omnibar prompts
 * and result items with Material Symbols icons.
 * 
 * @module omnibarIcons
 */

/**
 * Creates an icon container with context and action icons.
 * Used for standard omnibar prompts like history, bookmarks, etc.
 * 
 * @param {string} contextIcon - The main context icon name (Material Symbols)
 * @param {string} [actionIcon='search'] - The action icon name
 * @returns {string} HTML string for the icon container
 * 
 * @example
 * fnPromptIndicatorHtml('history', 'search')
 * // Returns icon container with history icon and search action
 */
const fnPromptIndicatorHtml = (contextIcon, actionIcon = 'search') => 
    `<div class="icon-container">
        <span class="material-symbols-outlined context-icon">${contextIcon}</span>
        <span class="material-symbols-outlined action-icon">${actionIcon}</span>
    </div>`;

/**
 * Creates an omni-style icon container with larger icons.
 * Used for prominent omnibar prompts.
 * 
 * @param {string} contextIcon - The main context icon name
 * @param {string} [actionIcon=''] - The action icon name (optional)
 * @returns {string} HTML string for the omni icon container
 */
const fnPromptOmni = (contextIcon, actionIcon = '') => 
    `<div class="icon-container">
        <span class="material-symbols-outlined context-icon context-icon-omni">${contextIcon}</span>
        <span class="material-symbols-outlined action-icon-omni action-icon">${actionIcon}</span>
    </div>`;

/**
 * Colorful bolt icon prompt used for OmniSearch.
 * Features stacked bolt icons with gradient colors.
 * 
 * @constant {string}
 */
const fnPromptBolt = `<span class="prompt">
    <span style="left: 19px;  top: 14px; font-size: 13px;color: #fff; position: absolute;" class="material-symbols-outlined">bolt</span>
    <span style="left: 14px;position: absolute;color: #ffffff;font-size: 29px;" class="material-symbols-outlined">search</span>
</span>`;

/**
 * Creates a simple icon span with Material Symbols.
 * Returns empty string if no icon is provided.
 * 
 * @param {string} icon - The icon name (Material Symbols)
 * @returns {string} HTML string for the icon or empty string
 * 
 * @example
 * fnIconHtml('folder_special') // Returns <span class="material-symbols-outlined">folder_special</span>
 * fnIconHtml('') // Returns ''
 */
const fnIconHtml = icon => 
    icon ? `<span class="material-symbols-outlined">${icon}</span>` : '';

/**
 * Icon names used throughout the omnibar.
 * Centralized for easy maintenance and consistency.
 * 
 * @constant {Object}
 */
const OMNIBAR_ICONS = {
    // Result type icons
    HISTORY: 'history',
    BOOKMARK: 'grade',
    TAB: 'tab',
    FOLDER: 'folder_special',
    PUBLIC: 'public',
    TAB_MOVE: 'tab_move',
    
    // Action icons
    SEARCH: 'search',
    ADD: 'add',
    EDIT: 'edit',
    
    // Feature icons
    TERMINAL: 'terminal',
    COLLECTIONS: 'collections_bookmark',
    HOTEL_STAR: 'hotel_class',
    MOVE_GROUP: 'move_group',
    TAB_RECENT: 'tab_recent',
    TAB_GROUP: 'tab_group'
};

export {
    fnPromptIndicatorHtml,
    fnPromptOmni,
    fnPromptBolt,
    fnIconHtml,
    OMNIBAR_ICONS
};
