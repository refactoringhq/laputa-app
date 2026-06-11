# CI/CD Setup

## GitHub Actions Workflow

Il workflow `ci.yml` esegue i seguenti check automatici:

### 1. Tests
- Frontend: `pnpm test`
- Rust backend: `cargo test`

### 2. Test Coverage
- Frontend: vitest con coverage reporting
- Upload automatico su Codecov dai report LCOV frontend + Rust
- Threshold configurabile in `vitest.config.ts`

### 3. Code Health (CodeScene)
- Delta analysis su ogni PR/push
- Fail se il code health diminuisce
- Richiede secrets configurati (vedi sotto)

### 4. Documentation Check
- Verifica che se cambia codice in `src/` o `src-tauri/`, anche `docs/` viene aggiornato
- **Warning only** — non blocca il merge, solo un reminder
- Skip con `[skip docs]` nel commit message
- Aggiorna docs solo se la modifica invalida architettura/astrazioni/design già documentati

### 5. Lint & Format
- ESLint per frontend
- Clippy + rustfmt per Rust

## Setup Required

### CodeScene Secrets
Aggiungi questi secrets nel repository GitHub (Settings → Secrets → Actions):

```
CODESCENE_TOKEN=<your-codescene-pat>
CODESCENE_PROJECT_ID=<your-project-id>
```

Il PAT di CodeScene è lo stesso che usi localmente (~/.codescene/token).
Il project ID lo trovi nella dashboard CodeScene.

### Codecov Setup
- Installa/attiva il repo in Codecov una volta sola tramite GitHub App / import del repository.
- Nessun `CODECOV_TOKEN` richiesto in GitHub Actions: `ci.yml` usa OIDC (`id-token: write` + `use_oidc: true`).
- Il workflow carica `coverage/lcov.info` (Vitest) e `coverage/rust.lcov` (cargo-llvm-cov).
- L'action Codecov resta con integrity validation attiva. Se Codecov ruota la chiave GPG del CLI, aggiorna il pin dell'action invece di usare `skip_validation`.

### Telemetry Secrets For Release Builds
Aggiungi anche questi secrets per i workflow `release.yml` e `release-stable.yml`:

```
VITE_SENTRY_DSN=<frontend sentry dsn>
SENTRY_DSN=<same dsn for rust/native crash reporting>
VITE_POSTHOG_KEY=<posthog project api key>
VITE_POSTHOG_HOST=https://eu.i.posthog.com
```

Senza questi valori, i build distribuiti possono mantenere i toggle telemetry nelle Settings ma non inizializzare davvero PostHog/Sentry.

### Windows Authenticode Secrets For Release Builds
Windows alpha e stable release builds usano sempre le firme Tauri updater. Se i secret Authenticode sono presenti, il workflow firma anche gli installer Windows e verifica le firme; se mancano, emette un warning e pubblica gli artifact Windows senza Authenticode finche' il certificato non e' pronto.

```
WINDOWS_CODE_SIGNING_CERTIFICATE=<base64-encoded pfx>
WINDOWS_CODE_SIGNING_CERTIFICATE_PASSWORD=<pfx password>
```

Opzionale:

```
WINDOWS_CODE_SIGNING_CERTIFICATE_THUMBPRINT=<expected thumbprint>
WINDOWS_CODE_SIGNING_TIMESTAMP_URL=https://timestamp.digicert.com
```

Il certificato deve essere un certificato di code signing trusted; un certificato self-signed non e' adatto per i release artifact pubblici.

### Coverage Thresholds
Configura in `vitest.config.ts`:

```typescript
export default defineConfig({
  test: {
    coverage: {
      lines: 80,
      functions: 80,
      branches: 80,
      statements: 80,
      // Fail CI se sotto threshold
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      }
    }
  }
})
```

## Local Testing

Prima di pushare, puoi testare localmente:

```bash
# Run all tests
pnpm test && cargo test

# Check coverage
pnpm test:coverage

# Lint
pnpm lint
cargo clippy
cargo fmt --check

# CodeScene (local)
codescene delta-analysis --base-revision origin/main
```

## Workflow Triggers

- **Push**: su `main`
- **Pull Request**: verso `main`
- **Manuale**: `workflow_dispatch`

Nota: l'upload a Codecov gira su push a `main` e sulle PR dello stesso repository. Le PR da fork saltano l'upload per evitare problemi di permessi OIDC.

## Status Checks

Tutti i check devono passare prima di poter fare merge.
Se un check fallisce, vedrai il dettaglio nei logs di GitHub Actions.
