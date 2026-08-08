# NAS scan boundary failure — RCA 0808

Failure slug: `nas-scan-parent-abort-on-protected-child-0808`

Related failure slug: `nas-scan-root-permission-misclassified-as-child-skip-0809`

Validation-environment failure slug: `tolaria-mcp-windows-path-separator-baseline-0809`

Production-scale E2E failure slug: `tolaria-nas-full-scan-unbounded-result-accumulation-0809`

## Symptom

A permission-denied or protected child could abort traversal of its parent. That
prevented later siblings and other configured vaults from being scanned.

## Root cause

Traversal and error policy were coupled. Recursive directory enumeration had no
child boundary at which expected `EACCES`/`EPERM` could be classified and
consumed, while protected/system/hidden directory names were not rejected before
recursion. A filesystem access policy condition therefore escaped as a scan-wide
failure.

The first boundary implementation also caught `EACCES`/`EPERM` at the public
vault-root call. That could misclassify an unavailable vault as a successfully
scanned empty vault. The cause was reusing the same recursive function without
carrying whether the current directory was a child boundary.

## Fix and regression guard

- reject recycle, system/hidden, and `000_개인폴더` children before recursion;
- catch only `EACCES`/`EPERM` at the child boundary and emit a sanitized skip;
- omit raw NAS paths, content, and credentials from the event;
- rethrow unexpected I/O such as `EIO`;
- continue sibling and multi-vault traversal;
- propagate permission failures at the vault root while skipping them only for
  recursive children;
- exercise two vaults and protected children in three fixture runs.

Node tests initially passed 2/2 in three runs. Semgrep and intended-diff Gitleaks reported
zero findings. No NAS access, permission mutation, move, or deletion occurred.

The focused scanner suite now passes 3/3 in three consecutive process runs. The
broader MCP suite runs after `npm ci`, but 10 pre-existing Windows-only assertions
expect POSIX `/` note paths while Node returns `\\`; 46/56 tests pass. Those
failures do not execute the new scanner policy and are classified separately
instead of being counted as a scanner pass. The earlier missing-SDK error was a
worktree dependency-installation failure, resolved from the committed lockfile.

Rollback: revert commit `009c82d6`; no production or NAS state needs restoration.

## Production-scale read-only E2E failure (2026-08-09)

The repository owner authorized a real read-only E2E against the two configured
UNC NAS vaults. The runner selected the two roots from local Tolaria
configuration in memory and emitted only ordinal counts, hashes, and sanitized
event fields. It did not read file content, persist paths or credentials, or
change NAS permissions/files.

The combined run exceeded the 120-second harness limit. An isolated run of the
first vault also exceeded five minutes, and a longer retry showed the Node
process working set grow to approximately 494 MB before it was terminated.
Neither run produced a completed summary, so this is **not** an E2E PASS.

### Root cause

`findMarkdownFiles()` materializes every discovered absolute path. Each
recursive frame first builds a child array and then spreads it into its parent
with `results.push(...childResults)`. Production-sized NAS trees therefore have
unbounded result retention, repeated array copying at directory boundaries, and
no deadline, cancellation, or progress contract. Fixture tests contain only a
few entries and could not expose this scale behavior. The earlier claim that a
real NAS E2E was merely forbidden hid this separate production-scale defect.

### Required corrective work

- expose traversal as an async iterator or callback so callers can consume
  bounded batches instead of retaining the full tree;
- add cancellation/deadline handling around directory enumeration;
- retain the existing child permission boundary and sanitized skip schema;
- add a high-cardinality synthetic regression with a bounded-memory assertion;
- rerun both configured NAS vaults independently and then together, recording
  only counts/hashes and sanitized event totals.

Until that work is implemented and both vaults complete, installation is
verified, fixture functionality is verified, and real NAS E2E/promotion remain
**NO-GO / UNVERIFIED**.
