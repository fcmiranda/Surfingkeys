import {
    createElementWithContent,
    showBanner,
    showPopup,
} from '../common/utils.js';
import { RUNTIME } from '../common/runtime.js';
import { tabOpenLink } from '../common/utils.js';

export default (omniCommand) => {
    omniCommand({
        cmd: "settings",
        annotation: "Open settings page",
        icon: "settings"
    }, function(args) {
        tabOpenLink("/pages/options.html");
    });
}