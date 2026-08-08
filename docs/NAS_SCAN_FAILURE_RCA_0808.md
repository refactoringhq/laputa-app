# NAS scan boundary failure — RCA 0808

Failure slug: `nas-scan-parent-abort-on-protected-child-0808`

Related failure slug: `nas-scan-root-permission-misclassified-as-child-skip-0809`

Validation-environment failure slug: `tolaria-mcp-windows-path-separator-baseline-0809`

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
