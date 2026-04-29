# Large Vault Loading QA

Use this when validating startup responsiveness for large vaults. The goal is to make the bottleneck reproducible without using a real user vault.

## Synthetic Vault

Create a disposable vault with many markdown files:

```bash
VAULT="$(mktemp -d /tmp/tolaria-large-vault.XXXXXX)"
mkdir -p "$VAULT/type" "$VAULT/archive" "$VAULT/assets"
cat > "$VAULT/type/project.md" <<'EOF'
---
is_a: Type
---
# Project
EOF

for i in $(seq -w 1 20000); do
  cat > "$VAULT/project-$i.md" <<EOF
---
is_a: Project
status: Active
related_to:
  - "[[project-00001]]"
---
# Project $i

Synthetic body $i with enough text to exercise parsing and snippets.
EOF
done

git -C "$VAULT" init
git -C "$VAULT" config user.email qa@example.invalid
git -C "$VAULT" config user.name "Tolaria QA"
git -C "$VAULT" add .
git -C "$VAULT" commit -m "seed large vault"
echo "$VAULT"
```

## Manual QA

1. Start Tolaria with `pnpm tauri dev`.
2. Open the synthetic vault path printed above.
3. Verify the main shell renders before the full note list finishes indexing.
4. Confirm the status bar shows vault activity while indexing is still in progress.
5. Use keyboard-only flows while indexing continues:
   - Cmd+K opens the command palette.
   - Cmd+P opens quick open; results may be partial or empty until indexing finishes.
   - Create a new note with Cmd+N and type in the editor.
6. Wait for indexing to finish and verify the note list/search state is consistent.

The synthetic vault lives under `/tmp`; remove it after QA if it is no longer needed.
