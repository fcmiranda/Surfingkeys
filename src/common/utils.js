function LOG(level, msg) {
    // To turn on all levels: chrome.storage.local.set({"logLevels": ["log", "warn", "error"]})
    chrome.storage.local.get(["logLevels"], (r) => {
        const logLevels = r && r.logLevels || ["error"];
        if (["log", "warn", "error"].indexOf(level) !== -1 && logLevels.indexOf(level) !== -1) {
            console[level](msg);
        }
    });
}

function regexFromString(str, caseSensitive, highlight) {
    var rxp = null;
    const flags = caseSensitive ? "" : "i";
    str = str.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
    if (highlight) {
        rxp = new RegExp(str.replace(/\s+/, "\|"), flags);
    } else {
        var words = str.split(/\s+/).map(function(w) {
            return `(?=.*${w})`;
        }).join('');
        rxp = new RegExp(`^${words}.*$`, flags);
    }
    return rxp;
}

function filterByTitleOrUrl(urls, query, caseSensitive) {
    if (query && query.length) {
        var rxp = regexFromString(query, caseSensitive, false);
        urls = urls.filter(function(b) {
            return rxp.test(b.title) || rxp.test(b.url);
        });
    }
    return urls;
}

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

export {
    LOG,
    filterByTitleOrUrl,
    regexFromString,
    safeDecodeURI,
}
