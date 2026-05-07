use super::{MediaReference, MediaReferenceKind};

struct MarkdownDestination {
    start: usize,
    end: usize,
    link_end: usize,
}

pub(super) fn markdown_media_references(markdown: &str) -> Vec<MediaReference> {
    let mut refs = Vec::new();
    let bytes = markdown.as_bytes();
    let mut index = 0;

    while let Some(offset) = markdown[index..].find('[') {
        let label_start = index + offset;
        let is_image = label_start > 0 && bytes[label_start - 1] == b'!';
        let Some(label_end) = find_markdown_label_end(bytes, label_start + 1) else {
            break;
        };
        if bytes.get(label_end + 1) != Some(&b'(') {
            index = label_end + 1;
            continue;
        }
        let Some(destination) = parse_markdown_destination(bytes, label_end + 2) else {
            index = label_end + 2;
            continue;
        };
        let destination_text = markdown[destination.start..destination.end]
            .trim()
            .to_string();
        if !destination_text.is_empty() {
            refs.push(MediaReference {
                destination_start: destination.start,
                destination_end: destination.end,
                destination: destination_text,
                kind: if is_image {
                    MediaReferenceKind::MarkdownImage
                } else {
                    MediaReferenceKind::MarkdownMediaLink
                },
            });
        }
        index = destination.link_end + 1;
    }

    refs
}

fn find_markdown_label_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut escaped = false;
    for (offset, byte) in bytes[start..].iter().enumerate() {
        if escaped {
            escaped = false;
            continue;
        }
        if *byte == b'\\' {
            escaped = true;
            continue;
        }
        if *byte == b']' {
            return Some(start + offset);
        }
    }
    None
}

fn parse_markdown_destination(bytes: &[u8], start: usize) -> Option<MarkdownDestination> {
    let destination_start = skip_ascii_whitespace(bytes, start);
    if bytes.get(destination_start) == Some(&b'<') {
        return parse_angle_markdown_destination(bytes, destination_start);
    }

    parse_plain_markdown_destination(bytes, destination_start)
}

fn parse_plain_markdown_destination(
    bytes: &[u8],
    destination_start: usize,
) -> Option<MarkdownDestination> {
    let mut escaped = false;
    let mut paren_depth = 0;
    for (offset, byte) in bytes[destination_start..].iter().enumerate() {
        let index = destination_start + offset;
        if let Some(destination) = scan_plain_markdown_destination_byte(
            bytes,
            destination_start,
            index,
            *byte,
            &mut escaped,
            &mut paren_depth,
        )? {
            return Some(destination);
        }
    }
    None
}

fn scan_plain_markdown_destination_byte(
    bytes: &[u8],
    destination_start: usize,
    index: usize,
    byte: u8,
    escaped: &mut bool,
    paren_depth: &mut usize,
) -> Option<Option<MarkdownDestination>> {
    if update_plain_destination_escape(escaped, byte) {
        return Some(None);
    }

    scan_unescaped_plain_destination_byte(bytes, destination_start, index, byte, paren_depth)
}

fn update_plain_destination_escape(escaped: &mut bool, byte: u8) -> bool {
    if *escaped {
        *escaped = false;
        return true;
    }
    if byte == b'\\' {
        *escaped = true;
        return true;
    }
    false
}

fn scan_unescaped_plain_destination_byte(
    bytes: &[u8],
    destination_start: usize,
    index: usize,
    byte: u8,
    paren_depth: &mut usize,
) -> Option<Option<MarkdownDestination>> {
    match byte {
        b'(' => {
            *paren_depth += 1;
            Some(None)
        }
        b')' => Some(scan_plain_destination_closing_paren(
            destination_start,
            index,
            paren_depth,
        )),
        _ if byte.is_ascii_whitespace() && *paren_depth == 0 => {
            let link_end = find_markdown_link_end_after_title(bytes, index)?;
            Some(Some(markdown_destination(
                destination_start,
                index,
                link_end,
            )))
        }
        _ => Some(None),
    }
}

fn scan_plain_destination_closing_paren(
    destination_start: usize,
    index: usize,
    paren_depth: &mut usize,
) -> Option<MarkdownDestination> {
    if *paren_depth == 0 {
        return Some(markdown_destination(destination_start, index, index));
    }
    *paren_depth -= 1;
    None
}

fn markdown_destination(start: usize, end: usize, link_end: usize) -> MarkdownDestination {
    MarkdownDestination {
        start,
        end,
        link_end,
    }
}

fn parse_angle_markdown_destination(bytes: &[u8], start: usize) -> Option<MarkdownDestination> {
    let mut escaped = false;
    for (offset, byte) in bytes[start + 1..].iter().enumerate() {
        let index = start + 1 + offset;
        if escaped {
            escaped = false;
            continue;
        }
        match *byte {
            b'\\' => escaped = true,
            b'>' => {
                let destination_end = index + 1;
                let link_end = find_markdown_link_end_after_title(bytes, destination_end)?;
                return Some(MarkdownDestination {
                    start,
                    end: destination_end,
                    link_end,
                });
            }
            _ => {}
        }
    }
    None
}

fn find_markdown_link_end_after_title(bytes: &[u8], start: usize) -> Option<usize> {
    let index = skip_ascii_whitespace(bytes, start);
    match bytes.get(index)? {
        b')' => Some(index),
        b'\'' | b'"' => find_quoted_title_link_end(bytes, index, bytes[index]),
        b'(' => find_parenthesized_title_link_end(bytes, index),
        _ => None,
    }
}

fn find_quoted_title_link_end(bytes: &[u8], start: usize, quote: u8) -> Option<usize> {
    let mut escaped = false;
    for (offset, byte) in bytes[start + 1..].iter().enumerate() {
        let index = start + 1 + offset;
        if escaped {
            escaped = false;
            continue;
        }
        match *byte {
            b'\\' => escaped = true,
            byte if byte == quote => {
                let closing = skip_ascii_whitespace(bytes, index + 1);
                return (bytes.get(closing) == Some(&b')')).then_some(closing);
            }
            _ => {}
        }
    }
    None
}

fn find_parenthesized_title_link_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut escaped = false;
    let mut depth = 1;
    for (offset, byte) in bytes[start + 1..].iter().enumerate() {
        let index = start + 1 + offset;
        if escaped {
            escaped = false;
            continue;
        }
        match *byte {
            b'\\' => escaped = true,
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    let closing = skip_ascii_whitespace(bytes, index + 1);
                    return (bytes.get(closing) == Some(&b')')).then_some(closing);
                }
            }
            _ => {}
        }
    }
    None
}

fn skip_ascii_whitespace(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .map_or(bytes.len(), |offset| start + offset)
}
