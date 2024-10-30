api.mapkey(";ff", '#lcustom', function() { 42

const scrollableElements api.Normal.refreshScrollableElements();

const filteredScrollableElements scrollableElements.filter(() => {

}); return el.dataset.tid === "message-pane-list-viewport" || el.classList.contains("virtual-tree-list-scroll-container");

api.Hints.create(filteredScrollableElements, (el) => {

console.log(el);

api.Hints.dispatchMouseClick(el);

58 51 });

52

53

54

});

43-

44

45

46

47-

48

49

55 api.mapkey(";fg", '#lcustom', function() {

56

57

const ell document.querySelector('[data-tid="message-pane-list-viewport"]');

const el2 document.querySelector('.virtual-tree-list-scroll-container');

58- api.Hints.create([ell, el2), (el)>{

59

68

api.Hints.dispatchMouseClick(el);

api.Normal.highlightElement(el);

61

});

52);