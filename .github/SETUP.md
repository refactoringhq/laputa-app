# CI/CD Setup Guide

## Quick Start

### 1. Add GitHub Secrets

Nel repository GitHub (Settings → Secrets and variables → Actions → New repository secret):

**CODESCENE_TOKEN**
```
<il tuo CodeScene PAT — stesso di ~/.codescene/token>
```

**CODESCENE_PROJECT_ID**  
Trova l'ID del progetto nella dashboard CodeScene (URL: `https://codescene.io/projects/<PROJECT_ID>/...`)

**VITE_SENTRY_DSN**
```
<frontend Sentry DSN used by shipped Tolaria builds>
```

**SENTRY_DSN**
```
<same DSN as VITE_SENTRY_DSN, passed to the Rust/Tauri build for native crash reporting>
```

**VITE_POSTHOG_KEY**
```
<PostHog project API key used by shipped Tolaria builds>
```

**VITE_POSTHOG_HOST**
```
https://eu.i.posthog.com
```

**Windows Authenticode release signing**

Windows release artifacts can be Authenticode-signed when a trusted code-signing certificate is available. Until Windows certificate provisioning is complete, the release workflow warns and publishes Windows artifacts with Tauri updater signatures only.

To enable Authenticode, configure a trusted certificate exported as base64 PFX data:

```
WINDOWS_CODE_SIGNING_CERTIFICATE=<base64-encoded pfx>
WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD=<pfx password>
```

Optional:

```
WINDOWS_CODE_SIGNING_CERTIFICATE_THUMBPRINT=<expected certificate thumbprint>
WINDOWS_CODE_SIGNING_TIMESTAMP_URL=https://timestamp.digicert.com
```

Legacy aliases `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD`, `WINDOWS_CERTIFICATE_THUMBPRINT`, and `WINDOWS_TIMESTAMP_URL` are still accepted by the signing script. Do not use a self-signed certificate for public releases; Windows Authenticode release signing needs a certificate from a trusted CA or signing service.

### 2. Enable GitHub Actions

- Vai su Settings → Actions → General
- Assicurati che "Allow all actions and reusable workflows" sia selezionato

### 3. Configure Branch Protection (Optional ma Raccomandato)

Settings → Branches → Add branch protection rule:

**Branch name pattern**: `main`

Abilita:
- ✅ Require status checks to pass before merging
  - Select: `Tests & Quality Checks`
- ✅ Require branches to be up to date before merging
- ✅ Do not allow bypassing the above settings

Questo forza tutti i check a passare prima di poter fare merge su main.

### 4. Test Locally Prima di Pushare

```bash
# Full test suite
pnpm test && cargo test --manifest-path=src-tauri/Cargo.toml

# Coverage
pnpm test:coverage

# Lint
pnpm lint
cargo clippy --manifest-path=src-tauri/Cargo.toml

# Format check
cargo fmt --manifest-path=src-tauri/Cargo.toml -- --check
```

## What Gets Checked

### ✅ Tests
- Frontend: Vitest
- Backend: `cargo test`

### 📊 Coverage
- Threshold: 70% (lines, functions, branches, statements)
- Configurabile in `vite.config.ts`

### 🏥 Code Health
- CodeScene delta analysis
- **Fail se code health diminuisce**
- Confronta HEAD vs base branch

### 📡 Telemetry In Release Builds
- `release.yml` e `release-stable.yml` devono ricevere `VITE_SENTRY_DSN`, `SENTRY_DSN`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST`
- `VITE_SENTRY_DSN` inizializza il frontend Sentry bundle
- `SENTRY_DSN` inizializza Sentry nel binary Rust/Tauri
- `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` permettono ai build distribuiti di inizializzare PostHog quando l'utente abilita analytics

### 📝 Documentation
- **Warning se modifichi `src/` o `src-tauri/` ma non aggiorni `docs/`**
- Non blocca il merge, solo un reminder
- Skip il check con `[skip docs]` nel commit message
- Aggiorna docs solo se la modifica invalida qualcosa già documentato

### 🎨 Lint & Format
- ESLint per frontend
- Clippy + rustfmt per Rust

## Workflow File

Il workflow è in `.github/workflows/ci.yml`.

**Trigger**: 
- Push su `main` o `experiment/*`
- Pull request verso `main`

**Runner**: `macos-latest` (necessario per Tauri + Rust)

## Customization

### Soglie Coverage

Modifica `vite.config.ts`:

```typescript
coverage: {
  thresholds: {
    lines: 80,     // Aumenta se vuoi più coverage
    functions: 80,
    branches: 80,
    statements: 80,
  }
}
```

### Documentation Check

Il check **avvisa** (non fallisce) se:
1. Modifichi file in `src/` o `src-tauri/`
2. NON modifichi nulla in `docs/`

**Quando aggiornare docs:**
- Cambi architettura → aggiorna `docs/ARCHITECTURE.md`
- Cambi astrazioni chiave → aggiorna `docs/ABSTRACTIONS.md`
- Cambi theme system → aggiorna `docs/THEMING.md`
- Bug fix / refactor interno → `[skip docs]` nel commit message

**Skip il check:**
```bash
git commit -m "fix: editor scroll bug [skip docs]"
```

### CodeScene Fail Threshold

Nel workflow, modifica:

```yaml
- name: CodeScene Delta Analysis
  uses: codescene-oss/codescene-delta-analysis-action@v1
  with:
    fail-on-declining-code-health: true  # Cambia a false per warning-only
    minimum-code-health-score: 8.0       # Aggiungi per soglia assoluta
```

## Troubleshooting

### CodeScene fails con "Project not found"
- Verifica che `CODESCENE_PROJECT_ID` sia corretto
- Controlla che il token abbia accesso al progetto

### Coverage check fails
- Verifica che `@vitest/coverage-v8` sia installato: `pnpm add -D @vitest/coverage-v8`
- Le soglie sono configurabili in `vite.config.ts`

### Docs check avvisa anche se non serve aggiornare docs
- È solo un warning, non blocca
- Skip con `[skip docs]` nel commit message
- Oppure ignora — è un reminder, non un requisito

### Workflow non si attiva
- Verifica che il file sia in `.github/workflows/ci.yml`
- Controlla che GitHub Actions sia abilitato nelle settings
- Il workflow parte solo su push/PR verso `main` o branch `experiment/*`

## Example CI Pass

```
✅ Run frontend tests
✅ Run Rust tests
✅ Run frontend coverage (75% lines, 73% functions)
✅ CodeScene Delta Analysis (code health: 9.2 → 9.3)
✅ Check docs are updated (docs/ARCHITECTURE.md modified)
✅ Lint frontend
✅ Clippy (Rust)
✅ Format check (Rust)
```

## Example CI Warning

```
⚠️  Code files changed but docs/ not updated
   Changed code files:
   - src/components/Editor.tsx
   - src-tauri/src/vault.rs
   
   If this change affects architecture/abstractions/design documented in docs/,
   please update the relevant documentation files.
   
   To skip this check, include [skip docs] in your commit message.
```

Questo è solo un reminder. Se la modifica non invalida la documentazione esistente, puoi ignorarlo o usare `[skip docs]`.
