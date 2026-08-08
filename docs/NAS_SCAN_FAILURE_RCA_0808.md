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

## HTTP validation endpoint unavailable (2026-08-09)

Failure slug: `tolaria-filestation-http-endpoint-unreachable-0809`

The HTTP-first retry probed DSM's documented read-only API discovery endpoint on
ports 5001 (HTTPS) and 5000 (HTTP). Both connections failed before HTTP with a
connect error after approximately two seconds. No authentication request was
made, no credential was read or stored, and the scanner did not fall back to
SMB/CIFS. The earlier SMB timing is therefore not promoted as HTTP evidence.
Standard HTTPS port 443 was likewise unreachable. Port 80 answered quickly, but
the API discovery route returned a short HTML response rather than Synology's
JSON API envelope, proving that listener is not the DSM FileStation API.

Root cause is currently bounded to network/service reachability: the workstation
can reach the NAS file share, but DSM WebAPI is not listening or not routed on
the probed management ports from this network. Distinguishing disabled DSM WebAPI
from firewall/VLAN routing requires NAS/network-owner action and is not safely
inferable by changing NAS configuration. Production permission, firewall, and
service settings remain untouched.

The corrective code adds a read-only FileStation HTTP adapter using POST-based
pagination (so the session is not placed in a URL), recursive sibling traversal,
sanitized child permission events, deadline/cancellation/progress, and a runner
that emits only counts and hashes. Actual two-vault HTTP E2E remains
**UNVERIFIED / NO-GO** until the endpoint is reachable and an ephemeral session
is supplied through the process environment.

## FileStation adapter not connected to the application (2026-08-09)

Failure slug: `tolaria-filestation-adapter-e2e-only-0809`

A live-readiness audit found that `streamFileStationMarkdownFiles()` is imported
only by its focused test and the standalone E2E runner. The MCP service and
desktop vault-loading paths still call the filesystem scanner. Shipping the
current branch would therefore install the safer filesystem traversal, but it
would not make Tolaria select HTTP transport for a configured NAS vault. A
passing standalone HTTP runner would not prove the application path functional.

### Root cause

The HTTP work was implemented as a transport adapter and validation harness
without first defining a transport-selection boundary in the production vault
abstraction. No configuration schema maps a registered vault to a FileStation
endpoint, remote root, or ephemeral session provider, and no caller dispatches
to the HTTP iterator. This is an integration-contract omission, not a DSM
listener failure.

On 2026-08-09 a fresh unauthenticated discovery request reached the configured
NAS on DSM port 5000 and reported `SYNO.FileStation.List` version 2. No session,
credential, raw path, or file content was sent or stored. This narrows the
earlier reachability failure to a transient network/service state; it does not
remove the missing application wiring or supply authorization for an actual
two-vault listing.

### Required corrective work

- define a redaction-safe registered-vault transport schema;
- resolve FileStation sessions ephemerally without persistence or logging;
- dispatch the real MCP/desktop scan call through the HTTP adapter;
- fail closed instead of silently falling back to SMB/CIFS;
- verify two configured vaults through the application call path, not only the
  standalone runner;
- retain filesystem scanning for explicitly local vaults and preserve rollback.

Until those changes and the authoritative CI gates pass, HTTP functional E2E and
promotion remain **UNVERIFIED / NO-GO**.

### Corrective implementation

The MCP stdio and desktop WebSocket bridge now expose the same `scan_vaults`
tool through `tool-service.js`. `TOLARIA_VAULT_TRANSPORT` is an explicit
`filesystem` or `filestation-http` choice. HTTP mode requires an endpoint, an
active-vault-to-remote-root JSON mapping, and an ephemeral session provider;
missing or invalid values fail closed and never retry through CIFS. The session
is removed from the process environment at service initialization and retained
only in process memory. Results contain only transport, vault label, and count.

The production caller regression uses the real MCP service with two vaults and
a mock HTTP contract. It proves dispatch without recording a session, remote
root, raw content, or credential. Focused boundary and caller tests passed three
consecutive runs. Repository-owned CircleCI now invokes the MCP suite. Live
authenticated listing remains **UNVERIFIED / NO-GO** because no approved
ephemeral FileStation session was available to this process.
