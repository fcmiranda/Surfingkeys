
api.mapkey(";ff", '#lcustom', function() {
    const scrollableElements = api.Normal.refreshScrollableElements();
    const filteredScrollableElements = scrollableElements.filter((el) => {
        return el.dataset.tid === "message-pane-list-viewport" || el.classList.contains("virtual-tree-list-scroll-container");
    }); 
    api.Hints.create(filteredScrollableElements, (el) => {
        console.log(el);
        api.Hints.dispatchMouseClick(el);
    });
});

api.mapkey(";fg", '#lcustom', function() {
    const ell = document.querySelector('[data-tid="message-pane-list-viewport"]');
    const el2 = document.querySelector('.virtual-tree-list-scroll-container');
    api.Hints.create([ell, el2], function (el) {
        api.Hints.dispatchMouseClick(el);
        api.Normal.highlightElement(el);
    });
});