import {
    extendObject,
    getSubSettings,
    start
} from './start.js';
import {
    LOG,
} from '../content_scripts/common/utils.js';

function loadRawSettings(keys, cb, defaultSet) {
    var rawSet = defaultSet || {};
    chrome.storage.local.get(null, function(localSet) {
        var localSavedAt = localSet.savedAt || 0;
        extendObject(rawSet, localSet);
        var subset = getSubSettings(rawSet, keys);
        if (chrome.runtime.lastError) {
            subset.error = "Settings sync may not work thoroughly because of: " + chrome.runtime.lastError.message;
        }
        cb(subset);
    });
}

function _applyProxySettings(proxyConf) {
}

function _setNewTabUrl(){
    return "about:newtab";
}

function _getContainerName(self, _response) {
    return function (message, sender, sendResponse){
        var cookieStoreId = sender.tab.cookieStoreId;
        browser.contextualIdentities.get(cookieStoreId).then(function(container){
            _response(message, sendResponse, {
                name : container.name
            });
        }, function(err){
            _response(message, sendResponse, {
                name : null
            });});
    };
}

function getLatestHistoryItem(text, maxResults, cb) {
    chrome.history.search({
        startTime: 0,
        text,
        maxResults
    }, function(items) {
        cb(items);
    });
}

function generatePassword() {
    const random = new Uint32Array(8);
    window.crypto.getRandomValues(random);
    return Array.from(random).join("");
}

let nativeConnected = false;
const nvimServer = {};
function startNative() {
    return new Promise((resolve, reject) => {
        const nm = chrome.runtime.connectNative("surfingkeys");
        const password = generatePassword();
        nm.onDisconnect.addListener((evt) => {
            if (chrome.runtime.lastError) {
                var error = chrome.runtime.lastError.message;
            }
            if (nativeConnected) {
                nvimServer.instance = startNative();
            } else {
                delete nvimServer.instance;
                LOG("error", "Failed to connect neovim, please make sure your neovim version 0.5 or above.");
            }
        });
        nm.onMessage.addListener(async (resp) => {
            if (resp.status === true) {
                nativeConnected = true;
                if (resp.res.event === "serverStarted") {
                    const url = `127.0.0.1:${resp.res.port}/${password}`;
                    resolve({url, nm});
                }
            } else if (resp.err) {
                LOG("error", resp.err);
            }
        });
        nm.postMessage({
            startServer: true,
            password
        });
    });
}
nvimServer.instance = startNative();

start({
    detectTabTitleChange: true,
    getLatestHistoryItem,
    nvimServer,
    loadRawSettings,
    _applyProxySettings,
    _setNewTabUrl,
    _getContainerName
});
