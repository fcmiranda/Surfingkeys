api.map('<Ctrl-j>', 'E'); //go one tab left,
api.map('<Ctrl-k>', 'R'); //go one tab right,
api.map('<Ctrl-h>', 'S'); //go back in history
api.map('<Ctrl-l>', 'D'); //go foward in history
api.cmap('<Ctrl-j>', '<Tab>'); //previous result item
api.cmap('<Ctrl-k>', '<Shift-Tab>'); //next result item



let currentScrollIndex = 0;

65 const selectors = ['[data-tid="message-pane-list-viewport"]', '.virtual-tree-list-scroll-container']

66 api.mapkey("cs", '#lcustom', function() {

67 currentScrollIndex (currentScrollIndex + 1) % 2;

68 const selector = document.querySelector(selectors (currentScrollIndex]);

69 console.log(selector);

70

api.Hints.dispatchMouseClick(selector); api.Normal.highlightElement(selector, 200);

71 72}, {domain: /teams.microsoft.com/i});