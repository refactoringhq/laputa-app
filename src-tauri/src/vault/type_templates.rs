pub(crate) struct TypeTemplateSource<'a> {
    pub explicit_template: Option<String>,
    pub is_a: Option<&'a str>,
    pub title: &'a str,
    pub body: &'a str,
}

struct TemplateLine<'a>(&'a str);

impl TemplateLine<'_> {
    fn has_structure(&self) -> bool {
        let trimmed = self.0.trim_start();
        trimmed.starts_with("## ")
            || trimmed.starts_with("- [ ] ")
            || TemplateLine(trimmed).is_field()
    }

    fn is_field(&self) -> bool {
        let trimmed = self.0.trim();
        if !trimmed.ends_with(':') {
            return false;
        }
        let label = trimmed.trim_end_matches(':').trim();
        !label.is_empty() && !label.starts_with('-')
    }
}

impl TypeTemplateSource<'_> {
    pub fn resolve(self) -> Option<String> {
        match self.explicit_template {
            Some(template) => Some(template),
            None if self.is_a == Some("Type") => self.body_template(),
            None => None,
        }
    }

    fn body_template(&self) -> Option<String> {
        let template = self.body_after_type_title()?.trim();
        if template
            .lines()
            .map(TemplateLine)
            .any(|line| line.has_structure())
        {
            Some(template.to_string())
        } else {
            None
        }
    }

    fn body_after_type_title(&self) -> Option<&str> {
        let body = self.body.trim_start();
        let (first_line, rest) = body.split_once('\n').unwrap_or((body, ""));
        let first_line = first_line.trim_end_matches('\r');
        let heading = first_line.strip_prefix("# ")?.trim();
        (heading == self.title).then_some(rest)
    }
}
