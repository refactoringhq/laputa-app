# NAS scan staging and rollback — 0808

- Installation: unchanged.
- Running: unchanged; fixture-only validation.
- Functional: two-vault fixture passed three consecutive runs.
- E2E: UNVERIFIED until a read-only staging scan and Graphify query-back succeed.
- Promotion: NO-GO before human approval.

Rollback by reverting this PR. No migration or data restoration is required because the
change only controls recursive enumeration. The validation must never alter NAS permissions,
move files, delete files, or persist raw NAS paths/content/credentials.

Exception record: for this PR only, the repository owner exempted the CodeScene/Codacy
pre-edit gates. Substitute checks are fixture regression, Node tests, Semgrep, Gitleaks,
and path/error-handling tests. CodeScene/Codacy revalidation remains separate backlog work.
