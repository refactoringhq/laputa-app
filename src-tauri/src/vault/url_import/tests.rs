use super::favicon::favicon_candidates_from_html;
use super::frontmatter::build_note_content;
use super::markdown::{ensure_single_primary_h1, parse_converted_markdown};
use super::media::{
    media_extension, read_limited_body, rewrite_markdown_media_with, validate_media_url_for_fetch,
    write_attachment,
};
use super::*;
use tempfile::TempDir;

fn page_url() -> Url {
    Url::parse("https://example.com/articles/page").unwrap()
}

#[test]
fn normalizes_bare_domains_and_rejects_non_http_schemes() {
    assert_eq!(
        normalize_page_url("example.com/post").unwrap().as_str(),
        "https://example.com/post"
    );
    assert!(normalize_page_url("ftp://example.com/file").is_err());
    assert!(normalize_page_url("https://example .com").is_err());
}

#[test]
fn builds_tolaria_frontmatter_with_clean_url_icon_and_defaults() {
    let defaults = vec![
        TypeInstanceDefault {
            key: "status".to_string(),
            value: Value::String("Active".to_string()),
            kind: "property".to_string(),
        },
        TypeInstanceDefault {
            key: "url".to_string(),
            value: Value::String("https://wrong.example".to_string()),
            kind: "property".to_string(),
        },
        TypeInstanceDefault {
            key: "Related to".to_string(),
            value: Value::Array(vec![Value::String("[[Research]]".to_string())]),
            kind: "relationship".to_string(),
        },
    ];

    let content = build_note_content(
        "Article",
        "https://example.com/post?a=1:b",
        Some("https://example.com/favicon.ico"),
        &defaults,
        "# Imported\n\nBody\n",
    );

    assert!(content.starts_with(
        "---\ntype: Article\nurl: \"https://example.com/post?a=1:b\"\nicon: \"https://example.com/favicon.ico\"\nstatus: Active\nRelated to:\n  - \"[[Research]]\"\n---\n\n# Imported"
    ));
    assert!(!content.contains("curl.md"));
    assert!(!content.contains("wrong.example"));
}

#[test]
fn strips_curl_md_frontmatter_footer_and_ensures_one_primary_h1() {
    let parsed = parse_converted_markdown(
        "---\ntitle: Sample Page\nurl: https://example.com/sample\n---\n\nIntro\n\n# Section\n\n---\nPowered by [curl.md](https://curl.md)\n",
    );
    let body = ensure_single_primary_h1(&parsed.body, parsed.title.as_deref().unwrap());

    assert_eq!(parsed.title.as_deref(), Some("Sample Page"));
    assert_eq!(parsed.url.unwrap().as_str(), "https://example.com/sample");
    assert_eq!(body, "# Sample Page\n\nIntro\n\n## Section\n");
}

#[test]
fn extracts_titles_only_from_non_fenced_h1_lines() {
    let parsed = parse_converted_markdown("```sh\n# install deps\n```\n\n# Real Title\n\nBody\n");

    assert_eq!(parsed.title.as_deref(), Some("Real Title"));
}

#[test]
fn preserves_fenced_h1_looking_lines_when_normalizing_headings() {
    let markdown = "# Article\n\n```sh\n# install deps\npnpm install\n```\n\n# Real section\n";
    let body = ensure_single_primary_h1(markdown, "Ignored");

    assert_eq!(
        body,
        "# Article\n\n```sh\n# install deps\npnpm install\n```\n\n## Real section\n"
    );
}

#[test]
fn inserts_title_without_demoting_fenced_code_comments() {
    let markdown = "Intro\n\n```sh\n# install deps\npnpm install\n```\n";
    let body = ensure_single_primary_h1(markdown, "Imported Page");

    assert_eq!(
        body,
        "# Imported Page\n\nIntro\n\n```sh\n# install deps\npnpm install\n```\n"
    );
}

#[test]
fn rewrites_markdown_media_refs_and_counts_partial_failures() {
    let markdown = "![Hero](/hero.png)\n\n![Broken](https://cdn.example.com/broken.jpg)\n\n![Inline](data:image/png;base64,abc)\n\n[Audio](/clip.mp3)\n\n[Regular link](/article)\n\n<video src=\"/movie.mp4\"></video>\n";
    let result = rewrite_markdown_media_with(markdown, &page_url(), |url, _| {
        if url.as_str().contains("broken") {
            Err("download failed".to_string())
        } else if url.path().ends_with(".mp3") {
            Ok(Some(
                "attachments/url-import-page-04-a1b2c3d4.mp3".to_string(),
            ))
        } else if url.path().ends_with(".mp4") {
            Ok(Some(
                "attachments/url-import-page-06-a1b2c3d4.mp4".to_string(),
            ))
        } else {
            Ok(Some(
                "attachments/url-import-page-01-a1b2c3d4.png".to_string(),
            ))
        }
    });

    assert!(result
        .markdown
        .contains("![Hero](attachments/url-import-page-01-a1b2c3d4.png)"));
    assert!(result
        .markdown
        .contains("![Broken](https://cdn.example.com/broken.jpg)"));
    assert!(result
        .markdown
        .contains("[Audio](attachments/url-import-page-04-a1b2c3d4.mp3)"));
    assert!(result.markdown.contains("[Regular link](/article)"));
    assert!(result
        .markdown
        .contains("<video src=\"attachments/url-import-page-06-a1b2c3d4.mp4\"></video>"));
    assert_eq!(result.saved_count, 3);
    assert_eq!(result.skipped_count, 2);
    assert_eq!(result.warnings, vec!["download failed"]);
}

#[test]
fn rewrites_markdown_destinations_with_parentheses_escapes_and_titles() {
    let markdown = "![One](/images/photo(1).png)\n![Two](</images/space pic.png> \"caption\")\n[Audio](/clips/a\\(b\\).mp3 'clip')\n";
    let result = rewrite_markdown_media_with(markdown, &page_url(), |url, _| {
        Ok(Some(format!("attachments{}", url.path())))
    });

    assert!(result
        .markdown
        .contains("![One](attachments/images/photo(1).png)"));
    assert!(result
        .markdown
        .contains("![Two](attachments/images/space%20pic.png \"caption\")"));
    assert!(result
        .markdown
        .contains("[Audio](attachments/clips/a(b).mp3 'clip')"));
    assert_eq!(result.saved_count, 3);
    assert_eq!(result.skipped_count, 0);
}

#[test]
fn ignores_markdown_media_refs_inside_fenced_code() {
    let markdown = "![Hero](/hero.png)\n\n```markdown\n![Code](/secret.png)\n<audio src=\"/secret.mp3\"></audio>\n```\n\n[Audio](/clip.mp3)\n";
    let mut saved = Vec::new();
    let result = rewrite_markdown_media_with(markdown, &page_url(), |url, _| {
        saved.push(url.path().to_string());
        Ok(Some(format!("attachments{}", url.path())))
    });

    assert_eq!(saved, vec!["/hero.png", "/clip.mp3"]);
    assert!(result.markdown.contains("![Hero](attachments/hero.png)"));
    assert!(result.markdown.contains("[Audio](attachments/clip.mp3)"));
    assert!(result
        .markdown
        .contains("```markdown\n![Code](/secret.png)\n<audio src=\"/secret.mp3\"></audio>\n```"));
    assert_eq!(result.saved_count, 2);
    assert_eq!(result.skipped_count, 0);
}

#[test]
fn writes_attachments_flat_with_unique_names() {
    let dir = TempDir::new().unwrap();
    let url = Url::parse("https://example.com/assets/photo.png").unwrap();
    let first = write_attachment(dir.path(), "sample-page", 1, &url, b"image", "png").unwrap();
    let second = write_attachment(dir.path(), "sample-page", 1, &url, b"image", "png").unwrap();

    assert!(first.starts_with("attachments/url-import-sample-page-01-"));
    assert!(second.starts_with("attachments/url-import-sample-page-01-"));
    assert_ne!(first, second);
    assert_eq!(
        fs::read_dir(dir.path().join("attachments"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.path().is_file())
            .count(),
        2
    );
}

#[test]
fn selects_supported_https_favicon_candidates_from_html() {
    let candidates = favicon_candidates_from_html(
        &page_url(),
        r#"
        <link rel="stylesheet" href="/app.css">
        <link rel="icon" type="image/png" href="/favicon.png">
        <link rel="apple-touch-icon" href="http://example.com/apple.png">
        <link rel="icon" href="/favicon.txt">
        "#,
    );

    let values = candidates.iter().map(Url::as_str).collect::<Vec<_>>();
    assert_eq!(
        values,
        vec![
            "https://example.com/favicon.png",
            "https://example.com/apple.png",
        ]
    );
}

#[test]
fn media_extension_accepts_common_image_audio_and_video_types() {
    let png = Url::parse("https://example.com/no-extension").unwrap();
    let mp4 = Url::parse("https://example.com/video").unwrap();
    let webp = Url::parse("https://example.com/image.webp").unwrap();

    assert_eq!(
        media_extension(&png, Some("image/png")),
        Some("png".to_string())
    );
    assert_eq!(
        media_extension(&mp4, Some("video/mp4")),
        Some("mp4".to_string())
    );
    assert_eq!(media_extension(&webp, None), Some("webp".to_string()));
}

#[test]
fn read_limited_body_enforces_cap_while_reading() {
    assert_eq!(
        read_limited_body(std::io::Cursor::new(vec![1, 2, 3]), 3, "test").unwrap(),
        Some(vec![1, 2, 3])
    );
    assert_eq!(
        read_limited_body(std::io::Cursor::new(vec![1, 2, 3, 4]), 3, "test").unwrap(),
        None
    );
}

#[test]
fn blocks_local_network_media_unless_page_origin_is_explicitly_local() {
    let public_page = Url::parse("https://example.com/page").unwrap();
    let loopback = Url::parse("http://127.0.0.1/image.png").unwrap();
    let private = Url::parse("http://10.0.0.5/image.png").unwrap();
    let localhost = Url::parse("http://localhost/image.png").unwrap();
    let same_local_page = Url::parse("http://localhost/assets/page").unwrap();
    let same_local_media = Url::parse("http://localhost/image.png").unwrap();
    let other_local_port = Url::parse("http://localhost:8080/image.png").unwrap();

    assert!(validate_media_url_for_fetch(&loopback, &public_page).is_err());
    assert!(validate_media_url_for_fetch(&private, &public_page).is_err());
    assert!(validate_media_url_for_fetch(&localhost, &public_page).is_err());
    assert!(validate_media_url_for_fetch(&same_local_media, &same_local_page).is_ok());
    assert!(validate_media_url_for_fetch(&other_local_port, &same_local_page).is_err());
}
