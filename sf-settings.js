api.map('<Ctrl-j>', 'E'); //go one tab left,
api.map('<Ctrl-k>', 'R'); //go one tab right,
api.map('<Ctrl-h>', 'S'); //go back in history
api.map('<Ctrl-l>', 'D'); //go foward in history
api.cmap('<Ctrl-j>', '<Tab>'); //previous result item
api.cmap('<Ctrl-k>', '<Shift-Tab>'); //next result item

let currentScrollIndex = 0;
const selectors = ['[data-tid="message-pane-list-viewport"]', '.virtual-tree-list-scroll-container']
api.mapkey("cs", '#lcustom', function() {
    currentScrollIndex = (currentScrollIndex + 1) % 2;
    const selector = document.querySelector(selectors[currentScrollIndex]);
    console.log(selector);
    api.Hints.dispatchMouseClick(selector); 
    api.highlightElement(selector, 200);
}, {domain: /teams.microsoft.com/i});


api.mapkey('n', 'teams', function() {
    const teamsSelectors = [
        'div[id|="message-body"]',
        'div[id|="new-message"]',
        'div[data-is-focusable="true"].ui-tree__title', 
        '#ms-searchux-input',
        '.ui-tree__title [aria-selected="true"]'
    ];
    api.Hints.create(teamsSelectors.join(), function(element) {
        element.focus();
    });
}, {domain: /teams.microsoft.com/i});