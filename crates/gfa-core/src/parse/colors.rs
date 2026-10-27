//! Colour strings as Qt 5's `QColor(QString)` reads them, since Bandage reads
//! the CL and C2 tags that way (`setColorFromString`, `get_hex_rgb` and
//! `rgbTbl` in qtbase 5.15 src/gui/painting/qcolor.cpp).

/// RGBA8 with red in the low byte, or `None` where Qt gives an invalid colour.
pub fn parse_color(text: &[u8]) -> Option<u32> {
    let [r, g, b, a] = match text.split_first() {
        Some((b'#', hex)) => from_hex(hex)?,
        _ => from_name(text)?,
    };
    Some(u32::from_le_bytes([r, g, b, a]))
}

fn from_hex(hex: &[u8]) -> Option<[u8; 4]> {
    let digits = |at: usize, n: usize| -> Option<u32> {
        let part = std::str::from_utf8(hex.get(at..at + n)?).ok()?;
        u32::from_str_radix(part, 16).ok()
    };
    // Qt widens every form to 16 bits a channel, then rounds back to 8.
    let (r, g, b, a) = match hex.len() {
        12 => (digits(0, 4)?, digits(4, 4)?, digits(8, 4)?, 0xffff),
        9 => {
            let widen = |c: u32| (c << 4) | (c >> 8);
            let (r, g, b) = (digits(0, 3)?, digits(3, 3)?, digits(6, 3)?);
            (widen(r), widen(g), widen(b), 0xffff)
        }
        8 => {
            let a = digits(0, 2)?;
            (
                digits(2, 2)? * 0x101,
                digits(4, 2)? * 0x101,
                digits(6, 2)? * 0x101,
                a * 0x101,
            )
        }
        6 => (
            digits(0, 2)? * 0x101,
            digits(2, 2)? * 0x101,
            digits(4, 2)? * 0x101,
            0xffff,
        ),
        3 => (
            digits(0, 1)? * 0x1111,
            digits(1, 1)? * 0x1111,
            digits(2, 1)? * 0x1111,
            0xffff,
        ),
        _ => return None,
    };
    Some([div_257(r), div_257(g), div_257(b), div_257(a)])
}

/// `QRgba64::div_257`: a 16-bit channel to 8 bits, rounded.
fn div_257(x: u32) -> u8 {
    let x = x + 128;
    ((x - (x >> 8)) >> 8) as u8
}

/// Qt drops spaces and tabs and ignores case before looking a name up.
fn from_name(text: &[u8]) -> Option<[u8; 4]> {
    let key: Vec<u8> = text
        .iter()
        .filter(|&&c| c != b' ' && c != b'\t')
        .map(u8::to_ascii_lowercase)
        .collect();
    if key == b"transparent" {
        return Some([0, 0, 0, 0]);
    }
    NAMES
        .binary_search_by(|(name, _)| name.cmp(&key.as_slice()))
        .ok()
        .map(|i| NAMES[i].1)
}

/// The SVG colour names, sorted as Qt's `rgbTbl`.
const NAMES: [(&[u8], [u8; 4]); 147] = [
    (b"aliceblue", [240, 248, 255, 255]),
    (b"antiquewhite", [250, 235, 215, 255]),
    (b"aqua", [0, 255, 255, 255]),
    (b"aquamarine", [127, 255, 212, 255]),
    (b"azure", [240, 255, 255, 255]),
    (b"beige", [245, 245, 220, 255]),
    (b"bisque", [255, 228, 196, 255]),
    (b"black", [0, 0, 0, 255]),
    (b"blanchedalmond", [255, 235, 205, 255]),
    (b"blue", [0, 0, 255, 255]),
    (b"blueviolet", [138, 43, 226, 255]),
    (b"brown", [165, 42, 42, 255]),
    (b"burlywood", [222, 184, 135, 255]),
    (b"cadetblue", [95, 158, 160, 255]),
    (b"chartreuse", [127, 255, 0, 255]),
    (b"chocolate", [210, 105, 30, 255]),
    (b"coral", [255, 127, 80, 255]),
    (b"cornflowerblue", [100, 149, 237, 255]),
    (b"cornsilk", [255, 248, 220, 255]),
    (b"crimson", [220, 20, 60, 255]),
    (b"cyan", [0, 255, 255, 255]),
    (b"darkblue", [0, 0, 139, 255]),
    (b"darkcyan", [0, 139, 139, 255]),
    (b"darkgoldenrod", [184, 134, 11, 255]),
    (b"darkgray", [169, 169, 169, 255]),
    (b"darkgreen", [0, 100, 0, 255]),
    (b"darkgrey", [169, 169, 169, 255]),
    (b"darkkhaki", [189, 183, 107, 255]),
    (b"darkmagenta", [139, 0, 139, 255]),
    (b"darkolivegreen", [85, 107, 47, 255]),
    (b"darkorange", [255, 140, 0, 255]),
    (b"darkorchid", [153, 50, 204, 255]),
    (b"darkred", [139, 0, 0, 255]),
    (b"darksalmon", [233, 150, 122, 255]),
    (b"darkseagreen", [143, 188, 143, 255]),
    (b"darkslateblue", [72, 61, 139, 255]),
    (b"darkslategray", [47, 79, 79, 255]),
    (b"darkslategrey", [47, 79, 79, 255]),
    (b"darkturquoise", [0, 206, 209, 255]),
    (b"darkviolet", [148, 0, 211, 255]),
    (b"deeppink", [255, 20, 147, 255]),
    (b"deepskyblue", [0, 191, 255, 255]),
    (b"dimgray", [105, 105, 105, 255]),
    (b"dimgrey", [105, 105, 105, 255]),
    (b"dodgerblue", [30, 144, 255, 255]),
    (b"firebrick", [178, 34, 34, 255]),
    (b"floralwhite", [255, 250, 240, 255]),
    (b"forestgreen", [34, 139, 34, 255]),
    (b"fuchsia", [255, 0, 255, 255]),
    (b"gainsboro", [220, 220, 220, 255]),
    (b"ghostwhite", [248, 248, 255, 255]),
    (b"gold", [255, 215, 0, 255]),
    (b"goldenrod", [218, 165, 32, 255]),
    (b"gray", [128, 128, 128, 255]),
    (b"green", [0, 128, 0, 255]),
    (b"greenyellow", [173, 255, 47, 255]),
    (b"grey", [128, 128, 128, 255]),
    (b"honeydew", [240, 255, 240, 255]),
    (b"hotpink", [255, 105, 180, 255]),
    (b"indianred", [205, 92, 92, 255]),
    (b"indigo", [75, 0, 130, 255]),
    (b"ivory", [255, 255, 240, 255]),
    (b"khaki", [240, 230, 140, 255]),
    (b"lavender", [230, 230, 250, 255]),
    (b"lavenderblush", [255, 240, 245, 255]),
    (b"lawngreen", [124, 252, 0, 255]),
    (b"lemonchiffon", [255, 250, 205, 255]),
    (b"lightblue", [173, 216, 230, 255]),
    (b"lightcoral", [240, 128, 128, 255]),
    (b"lightcyan", [224, 255, 255, 255]),
    (b"lightgoldenrodyellow", [250, 250, 210, 255]),
    (b"lightgray", [211, 211, 211, 255]),
    (b"lightgreen", [144, 238, 144, 255]),
    (b"lightgrey", [211, 211, 211, 255]),
    (b"lightpink", [255, 182, 193, 255]),
    (b"lightsalmon", [255, 160, 122, 255]),
    (b"lightseagreen", [32, 178, 170, 255]),
    (b"lightskyblue", [135, 206, 250, 255]),
    (b"lightslategray", [119, 136, 153, 255]),
    (b"lightslategrey", [119, 136, 153, 255]),
    (b"lightsteelblue", [176, 196, 222, 255]),
    (b"lightyellow", [255, 255, 224, 255]),
    (b"lime", [0, 255, 0, 255]),
    (b"limegreen", [50, 205, 50, 255]),
    (b"linen", [250, 240, 230, 255]),
    (b"magenta", [255, 0, 255, 255]),
    (b"maroon", [128, 0, 0, 255]),
    (b"mediumaquamarine", [102, 205, 170, 255]),
    (b"mediumblue", [0, 0, 205, 255]),
    (b"mediumorchid", [186, 85, 211, 255]),
    (b"mediumpurple", [147, 112, 219, 255]),
    (b"mediumseagreen", [60, 179, 113, 255]),
    (b"mediumslateblue", [123, 104, 238, 255]),
    (b"mediumspringgreen", [0, 250, 154, 255]),
    (b"mediumturquoise", [72, 209, 204, 255]),
    (b"mediumvioletred", [199, 21, 133, 255]),
    (b"midnightblue", [25, 25, 112, 255]),
    (b"mintcream", [245, 255, 250, 255]),
    (b"mistyrose", [255, 228, 225, 255]),
    (b"moccasin", [255, 228, 181, 255]),
    (b"navajowhite", [255, 222, 173, 255]),
    (b"navy", [0, 0, 128, 255]),
    (b"oldlace", [253, 245, 230, 255]),
    (b"olive", [128, 128, 0, 255]),
    (b"olivedrab", [107, 142, 35, 255]),
    (b"orange", [255, 165, 0, 255]),
    (b"orangered", [255, 69, 0, 255]),
    (b"orchid", [218, 112, 214, 255]),
    (b"palegoldenrod", [238, 232, 170, 255]),
    (b"palegreen", [152, 251, 152, 255]),
    (b"paleturquoise", [175, 238, 238, 255]),
    (b"palevioletred", [219, 112, 147, 255]),
    (b"papayawhip", [255, 239, 213, 255]),
    (b"peachpuff", [255, 218, 185, 255]),
    (b"peru", [205, 133, 63, 255]),
    (b"pink", [255, 192, 203, 255]),
    (b"plum", [221, 160, 221, 255]),
    (b"powderblue", [176, 224, 230, 255]),
    (b"purple", [128, 0, 128, 255]),
    (b"red", [255, 0, 0, 255]),
    (b"rosybrown", [188, 143, 143, 255]),
    (b"royalblue", [65, 105, 225, 255]),
    (b"saddlebrown", [139, 69, 19, 255]),
    (b"salmon", [250, 128, 114, 255]),
    (b"sandybrown", [244, 164, 96, 255]),
    (b"seagreen", [46, 139, 87, 255]),
    (b"seashell", [255, 245, 238, 255]),
    (b"sienna", [160, 82, 45, 255]),
    (b"silver", [192, 192, 192, 255]),
    (b"skyblue", [135, 206, 235, 255]),
    (b"slateblue", [106, 90, 205, 255]),
    (b"slategray", [112, 128, 144, 255]),
    (b"slategrey", [112, 128, 144, 255]),
    (b"snow", [255, 250, 250, 255]),
    (b"springgreen", [0, 255, 127, 255]),
    (b"steelblue", [70, 130, 180, 255]),
    (b"tan", [210, 180, 140, 255]),
    (b"teal", [0, 128, 128, 255]),
    (b"thistle", [216, 191, 216, 255]),
    (b"tomato", [255, 99, 71, 255]),
    (b"turquoise", [64, 224, 208, 255]),
    (b"violet", [238, 130, 238, 255]),
    (b"wheat", [245, 222, 179, 255]),
    (b"white", [255, 255, 255, 255]),
    (b"whitesmoke", [245, 245, 245, 255]),
    (b"yellow", [255, 255, 0, 255]),
    (b"yellowgreen", [154, 205, 50, 255]),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(text: &str) -> Option<[u8; 4]> {
        parse_color(text.as_bytes()).map(u32::to_le_bytes)
    }

    #[test]
    fn hex_forms() {
        assert_eq!(rgba("#f00"), Some([255, 0, 0, 255]));
        assert_eq!(rgba("#1a2B3c"), Some([0x1a, 0x2b, 0x3c, 255]));
        assert_eq!(rgba("#80ff0000"), Some([255, 0, 0, 0x80]));
        assert_eq!(rgba("#fff000800"), Some([255, 0, 128, 255]));
        assert_eq!(rgba("#ffff00008000"), Some([255, 0, 128, 255]));
    }

    #[test]
    fn names_ignore_case_and_spaces() {
        assert_eq!(rgba("Red"), Some([255, 0, 0, 255]));
        assert_eq!(rgba("light Sea\tGreen"), Some([32, 178, 170, 255]));
        assert_eq!(rgba("transparent"), Some([0, 0, 0, 0]));
    }

    #[test]
    fn invalid() {
        for text in ["", "#", "#12", "#12345", "#ggg", "notacolour", "rgb(1,2,3)"] {
            assert_eq!(rgba(text), None, "{text}");
        }
    }

    #[test]
    fn table_is_sorted() {
        assert!(NAMES.windows(2).all(|w| w[0].0 < w[1].0));
    }
}
