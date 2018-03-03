// see https://github.com/openstreetmap/iD/pull/3707
// https://gist.github.com/mapmeld/556b09ddec07a2044c76e1ef45f01c60

var chars = {
    // madda above alef
    1570: { initial: '\u0622\u200E', isolated: '\u0622\u200E',
        medial: '\u0622\u200E', final: '\uFE82' },

    // hamza above and below alef
    1571: {initial: '\u0623', isolated: '\u0623', medial: '', final: '\uFE84'},
    // 1572 is \u0624
    1573: {initial: '\u0625', isolated: '\u0625', medial: '', final: '\uFE88'},
    // 1574 is \u0626
    1575: {initial: '\u0627', isolated: '\u0627', medial: '', final: '\uFE8E'},
    1576: { initial: '\uFE91', isolated: '\uFE8F', medial: '\uFE92',
        final: '\uFE90' },

    // 1577 \u0629
    1577: { initial: '', isolated: '\u0629', medial: '', final: '\uFE94' },

    1578: { initial: '\uFE97', isolated: '\uFE95', medial: '\uFE98',
        final: '\uFE96' },
    1579: { initial: '\uFE9B', isolated: '\uFE99', medial: '\uFE9C',
        final: '\uFE9A' },
    1580: { initial: '\uFE9F', isolated: '\uFE9D', medial: '\uFEA0',
        final: '\uFE9E' },
    1581: { initial: '\uFEA3', isolated: '\uFEA1', medial: '\uFEA4',
        final: '\uFEA2' },
    1582: { initial: '\uFEA7', isolated: '\uFEA5', medial: '\uFEA8',
        final: '\uFEA6' },
    1583: { initial: '\uFEA9', isolated: '\uFEA9', medial: '',
        final: '\uFEAA' },
    1584: { initial: '\uFEAB', isolated: '\uFEAB', medial: '',
        final: '\uFEAC' },
    1585: { initial: '\uFEAD', isolated: '\uFEAD', medial: '',
        final: '\uFEAE' },
    1586: { initial: '\uFEAF', isolated: '\uFEAF', medial: '',
        final: '\uFEB0' },
    1688: { initial: '\uFB8A', isolated: '\uFB8A', medial: '',
        final: '\uFB8B' },
    1587: { initial: '\uFEB3', isolated: '\uFEB1', medial: '\uFEB4',
        final: '\uFEB2' },
    1588: { initial: '\uFEB7', isolated: '\uFEB5', medial: '\uFEB8',
        final: '\uFEB6' },
    1589: { initial: '\uFEBB', isolated: '\uFEB9', medial: '\uFEBC',
        final: '\uFEBA' },
    1590: { initial: '\uFEBF', isolated: '\uFEBD', medial: '\uFEC0',
        final: '\uFEBE' },
    1591: { initial: '\uFEC3', isolated: '\uFEC1', medial: '\uFEC4',
        final: '\uFEC2' },
    1592: { initial: '\uFEC7', isolated: '\uFEC5', medial: '\uFEC8',
        final: '\uFEC6' },
    1593: { initial: '\uFECB', isolated: '\uFEC9', medial: '\uFECC',
        final: '\uFECA' },
    1594: { initial: '\uFECF', isolated: '\uFECD', medial: '\uFED0',
        final: '\uFECE' },

    // 1595 \u063B - may be very rare

    1601: { initial: '\uFED3', isolated: '\uFED1', medial: '\uFED4',
        final: '\uFED2' },
    1602: { initial: '\uFED7', isolated: '\uFED5', medial: '\uFED8',
        final: '\uFED6' },
    1604: { initial: '\uFEDF', isolated: '\uFEDD', medial: '\uFEE0',
        final: '\uFEDE' },
    1605: { initial: '\uFEE3', isolated: '\uFEE1', medial: '\uFEE4',
        final: '\uFEE2' },
    1606: { initial: '\uFEE7', isolated: '\uFEE5', medial: '\uFEE8',
        final: '\uFEE6' },
    1607: { initial: '\uFEEB', isolated: '\uFEE9', medial: '\uFEEC',
        final: '\uFEEA' },
    1608: { initial: '\uFEED', isolated: '\uFEED', medial: '',
        final: '\uFEEE' },

    // 1609 \u0649
    1609: { initial: '\uFBE8', isolated: '\uFEEF', medial: '\uFBE9',
        final: '\uFEF0' },
    // 1610 \u064A
    1610: { initial: '\uFEF3', isolated: '\uFEF1', medial: '\uFEF4',
        final: '\uFEF2' },

    // short vowel sounds / tashkil markings

    1662: { initial: '\uFB58', isolated: '\uFB56', medial: '\uFB59',
        final: '\uFB57' },

    1670: { initial: '\uFB7C', isolated: '\uFB7A', medial: '\uFB7D',
        final: '\uFB7B' },
    1603: { initial: '\uFEDB', isolated: '\uFED9', medial: '\uFEDC',
        final: '\uFEDA' },
    1705: { initial: '\uFEDB', isolated: '\uFB8E', medial: '\uFEDC',
        final: '\uFB8F' },
    1711: { initial: '\uFB94', isolated: '\uFB92', medial: '\uFB95',
        final: '\uFB93' },
    1740: { initial: '\uFEF3', isolated: '\uFEEF', medial: '\uFEF4',
        final: '\uFEF0' },
    5000: { initial: '\uFEFB', isolated: '\uFEFB', medial: '',
        final: '\uFEFC' }
};

export var rtlRegex = /[\u0590-\u05FF\u0600-\u06FF\u0780-\u07BF]/;

export function fixRTLTextForSvg(inputText) {
    var context = true;
    var ret = '';
    var rtlBuffer = [];
    var arabicRegex = /[\u0600-\u06FF]/g;
    var arabicTashkil = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7\u06E8\u06EA-\u06ED]/;
    var thaanaVowel = /[\u07A6-\u07B0]/;
    var hebrewSign = /[\u0591-\u05bd\u05bf\u05c1-\u05c5\u05c7]/;

    if (!arabicRegex.test(inputText)) {
        // Hebrew or Thaana RTL script
        for (var n = 0; n < inputText.length; n++) {
            var c = inputText[n];
            if ((thaanaVowel.test(c) || hebrewSign.test(c)) &&
                rtlBuffer.length) {
                rtlBuffer[rtlBuffer.length - 1] += c;
            } else if (rtlRegex.test(c)) {
                rtlBuffer.push(c);
            } else if (c === ' ' && rtlBuffer.length) {
                // whitespace within RTL text
                rtlBuffer = [rtlBuffer.reverse().join('') + ' '];
            } else {
                // non-RTL character
                ret += rtlBuffer.reverse().join('') + c;
                rtlBuffer = [];
            }
        }
    } else {
        for (var i = 0, l = inputText.length; i < l; i++) {
            var code = inputText[i].charCodeAt(0);
            var nextCode = inputText[i + 1]
                ? inputText[i + 1].charCodeAt(0)
                : 0;

            if (!chars[code]) {
                if (code === 32 && rtlBuffer.length) {
                    // whitespace
                    rtlBuffer = [rtlBuffer.reverse().join('') + ' '];
                } else if (arabicTashkil.test(inputText[i]) &&
                    rtlBuffer.length) {
                    // tashkil mark
                    rtlBuffer[rtlBuffer.length - 1] += inputText[i];
                } else {
                    // non-RTL character
                    ret += rtlBuffer.reverse().join('') + inputText[i];
                    rtlBuffer = [];
                }
                continue;
            }
            if (context) {
                if (i === l - 1 || nextCode === 32) {
                    rtlBuffer.push(chars[code].isolated);
                } else {
                    // special case for \u0644\u0627
                    if (code === 1604 && nextCode === 1575) {
                        rtlBuffer.push(chars[5000].initial);
                        i++;
                        context = true;
                        continue;
                    }
                    rtlBuffer.push(chars[code].initial);
                }
            } else {
                if (i === l - 1 || nextCode === 32){
                    rtlBuffer.push(chars[code].final);
                } else {
                    // special case for \uFEFC
                    if (code === 1604 && nextCode === 1575){
                        rtlBuffer.push(chars[5000].final);
                        i++;
                        context = true;
                        continue;
                    }
                    if (chars[code].medial === ''){
                        rtlBuffer.push(chars[code].final);
                    } else {
                        rtlBuffer.push(chars[code].medial);
                    }
                }
            }
            context = (chars[code].medial === '') || nextCode === 32;
        }
    }
    ret += rtlBuffer.reverse().join('');
    return ret;
}
