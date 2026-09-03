use super::count_body_words;
use serde::Deserialize;

#[derive(Deserialize)]
struct WordCountFixture {
    name: String,
    content: String,
    expected: u32,
}

#[derive(Deserialize)]
struct WordCountContract {
    fixtures: Vec<WordCountFixture>,
}

#[test]
fn matches_the_shared_word_count_contract() {
    let contract: WordCountContract =
        serde_json::from_str(include_str!("../../../src/shared/wordCountContract.json"))
            .expect("shared word-count fixtures must be valid JSON");

    for fixture in contract.fixtures {
        assert_eq!(
            count_body_words(&fixture.content),
            fixture.expected,
            "fixture: {}",
            fixture.name
        );
    }
}
