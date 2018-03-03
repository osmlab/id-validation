import { t } from '../util/locale';
import { utilDetect } from '../util/detect';

// Translate a MacOS key command into the appropriate Windows/Linux equivalent.
// For example, cmd + Z -> Ctrl+Z
export var uiCmd = function (code) {
    var detected = utilDetect();

    if (detected.os === 'mac') {
        return code;
    }

    if (detected.os === 'win') {
        if (code === '\u2318\u21E7Z') return 'Ctrl+Y';  // cmd + shift + Z
    }

    var result = '',
        replacements = {
            '\u2318': 'Ctrl',  // MacOS cmd
            '\u21E7': 'Shift',
            '\u2325': 'Alt',  // MacOS alt
            '\u232B': 'Backspace',
            '\u2326': 'Delete'
        };

    for (var i = 0; i < code.length; i++) {
        if (code[i] in replacements) {
            result += replacements[code[i]] + (i < code.length - 1 ? '+' : '');
        } else {
            result += code[i];
        }
    }

    return result;
};


// return a display-focused string for a given keyboard code
uiCmd.display = function(code) {
    if (code.length !== 1) return code;

    var detected = utilDetect();
    var mac = (detected.os === 'mac');
    var replacements = {
        '\u2318': mac
            ? '\u2318 ' + t('shortcuts.key.cmd')
            : t('shortcuts.key.ctrl'),
        '\u21E7': mac
            ? '\u21E7 ' + t('shortcuts.key.shift')
            : t('shortcuts.key.shift'),
        '\u2325': mac
            ? '\u2325 ' + t('shortcuts.key.option')
            : t('shortcuts.key.alt'),
        '\u2303': mac
            ? '\u2303 ' + t('shortcuts.key.ctrl')
            : t('shortcuts.key.ctrl'),
        '\u232B': mac
            ? '\u232B ' + t('shortcuts.key.delete')
            : t('shortcuts.key.backspace'),
        '\u2326': mac
            ? '\u2326 ' + t('shortcuts.key.del')
            : t('shortcuts.key.del'),
        '\u2196': mac
            ? '\u2196 ' + t('shortcuts.key.pgup')
            : t('shortcuts.key.pgup'),
        '\u2198': mac
            ? '\u2198 ' + t('shortcuts.key.pgdn')
            : t('shortcuts.key.pgdn'),
        '\u21DE': mac
            ? '\u21DE ' + t('shortcuts.key.home')
            : t('shortcuts.key.home'),
        '\u21DF': mac
            ? '\u21DF ' + t('shortcuts.key.end')
            : t('shortcuts.key.end'),
        '\u21B5': mac
            ? '\u21B5 ' + t('shortcuts.key.return')
            : t('shortcuts.key.enter'),
        '\u238B': mac
            ? '\u238B ' + t('shortcuts.key.esc')
            : t('shortcuts.key.esc'),
    };

    return replacements[code] || code;
};
