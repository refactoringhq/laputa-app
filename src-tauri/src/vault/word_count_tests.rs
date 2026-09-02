use super::count_body_words;

#[test]
fn counts_the_reported_repeated_english_words() {
    let content = "abc, efg\n\nabc, efg\n\nabc, efg\n\nabc, efg\n\nabc\n\nabc";

    assert_eq!(count_body_words(content), 10);
}

#[test]
fn counts_unspaced_cjk_characters() {
    assert_eq!(count_body_words("中文没有空格"), 6);
}

#[test]
fn counts_cjk_characters_alongside_latin_and_numeric_words() {
    assert_eq!(count_body_words("Hello 世界 2026"), 4);
}
