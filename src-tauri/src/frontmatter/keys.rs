#[derive(Clone, Copy)]
pub(crate) struct FrontmatterKeyRule {
    read_key: &'static str,
    write_key: &'static str,
    aliases: &'static [&'static str],
    canonicalize_on_write: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct FrontmatterKey<'a>(&'a str);

impl<'a> FrontmatterKey<'a> {
    pub(crate) fn new(key: &'a str) -> Self {
        Self(key)
    }

    pub(crate) fn normalized(self) -> String {
        self.0.trim().to_ascii_lowercase().replace(' ', "_")
    }

    pub(crate) fn is_reserved(self) -> bool {
        self.normalized().starts_with('_') || is_known_frontmatter_key(self)
    }
}

const KNOWN_FRONTMATTER_KEYS: &[FrontmatterKeyRule] = &[
    FrontmatterKeyRule {
        read_key: "title",
        write_key: "title",
        aliases: &["title"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "type",
        write_key: "type",
        aliases: &["type", "is_a", "Is A"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "aliases",
        write_key: "aliases",
        aliases: &["aliases"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_archived",
        write_key: "_archived",
        aliases: &["_archived", "Archived", "archived"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "Status",
        write_key: "Status",
        aliases: &["Status", "status"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_icon",
        write_key: "_icon",
        aliases: &["_icon", "icon"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "color",
        write_key: "color",
        aliases: &["color"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_order",
        write_key: "_order",
        aliases: &["_order", "order"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "_sidebar_label",
        write_key: "_sidebar_label",
        aliases: &["_sidebar_label", "sidebar_label", "sidebar label"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "template",
        write_key: "template",
        aliases: &["template"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_sort",
        write_key: "_sort",
        aliases: &["_sort", "sort"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "view",
        write_key: "view",
        aliases: &["view"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_width",
        write_key: "_width",
        aliases: &["_width", "width"],
        canonicalize_on_write: true,
    },
    FrontmatterKeyRule {
        read_key: "visible",
        write_key: "visible",
        aliases: &["visible"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_organized",
        write_key: "_organized",
        aliases: &["_organized"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_favorite",
        write_key: "_favorite",
        aliases: &["_favorite"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_favorite_index",
        write_key: "_favorite_index",
        aliases: &["_favorite_index"],
        canonicalize_on_write: false,
    },
    FrontmatterKeyRule {
        read_key: "_list_properties_display",
        write_key: "_list_properties_display",
        aliases: &["_list_properties_display"],
        canonicalize_on_write: false,
    },
];

impl FrontmatterKeyRule {
    pub(crate) fn read_key(self) -> &'static str {
        self.read_key
    }

    pub(crate) fn write_key(self) -> &'static str {
        self.write_key
    }

    pub(crate) fn canonicalizes_on_write(self) -> bool {
        self.canonicalize_on_write
    }

    fn matches(self, key: FrontmatterKey<'_>) -> bool {
        let normalized = key.normalized();
        self.aliases
            .iter()
            .any(|alias| FrontmatterKey::new(alias).normalized() == normalized)
    }
}

pub(crate) fn frontmatter_key_rule(key: FrontmatterKey<'_>) -> Option<FrontmatterKeyRule> {
    KNOWN_FRONTMATTER_KEYS
        .iter()
        .copied()
        .find(|rule| rule.matches(key))
}

pub(crate) fn canonical_known_frontmatter_key(key: FrontmatterKey<'_>) -> Option<&'static str> {
    frontmatter_key_rule(key).map(FrontmatterKeyRule::read_key)
}

pub(crate) fn frontmatter_keys_match(left: FrontmatterKey<'_>, right: FrontmatterKey<'_>) -> bool {
    match (frontmatter_key_rule(left), frontmatter_key_rule(right)) {
        (Some(left_rule), Some(right_rule)) => left_rule.read_key() == right_rule.read_key(),
        _ => left.normalized() == right.normalized(),
    }
}

pub(crate) fn is_known_frontmatter_key(key: FrontmatterKey<'_>) -> bool {
    frontmatter_key_rule(key).is_some()
}
