# NAS scan boundary failure — RCA 0808

Failure slug: `nas-scan-parent-abort-on-protected-child-0808`

## Symptom

A permission-denied or protected child could abort traversal of its parent. That
prevented later siblings and other configured vaults from being scanned.

## Root cause

Traversal and error policy were coupled. Recursive directory enumeration had no
child boundary at which expected `EACCES`/`EPERM` could be classified and
consumed, while protected/system/hidden directory names were not rejected before
recursion. A filesystem access policy condition therefore escaped as a scan-wide
failure.

## Fix and regression guard

- reject recycle, system/hidden, and `000_개인폴더` children before recursion;
- catch only `EACCES`/`EPERM` at the child boundary and emit a sanitized skip;
- omit raw NAS paths, content, and credentials from the event;
- rethrow unexpected I/O such as `EIO`;
- continue sibling and multi-vault traversal;
- exercise two vaults and protected children in three fixture runs.

Node tests passed 2/2 in three runs. Semgrep and intended-diff Gitleaks reported
zero findings. No NAS access, permission mutation, move, or deletion occurred.

Rollback: revert commit `009c82d6`; no production or NAS state needs restoration.
