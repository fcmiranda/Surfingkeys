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
        var regExpression =  str.replace(/\s+/gi, "\|");
        rxp = new RegExp(regExpression, "gi");
    } else {
        var words = str.split(/\s+/).map(function(w) {
            return `(?=.*${w})`;
        }).join('');
        rxp = new RegExp(`^${words}.*$`, flags);
    }
    return rxp;
}

function filterByTitleOrUrl(urls, query, caseSensitive) {
    // Preserve legacy signature by keeping the optional caseSensitive flag while
    // still applying the safer URL decoding logic introduced recently.
    if (query && query.length) {
        const rxp = regexFromString(query, caseSensitive, false);
        urls = urls.filter(function(b) {
            return rxp.test(b.title) || rxp.test(safeDecodeURI(b.url));
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

function filterByName(commands, query) {
    return commands.filter(command => {
        var rxp = regexFromString(query, false);
        return rxp.test(command.name);
    });
}

export {
    LOG,
    filterByName,
    filterByTitleOrUrl,
    regexFromString,
    safeDecodeURI,
}
