{ pkgs, lib }:

# Fetches the pnpm dependency graph deterministically using `pnpm-lock.yaml`,
# honoring the `pnpm.overrides` and `pnpm.patchedDependencies` blocks from
# package.json. The output is a /nix/store path containing an offline pnpm
# store that the Tauri build consumes via `pnpm install --offline`.
#
# Hash workflow:
#   1. First build fails with the real hash on `got:` line.
#   2. Replace `hash = ""` below with that value.
#   3. Re-run `nix build .#tolaria-node-modules`.
#
# When dependencies change (pnpm-lock.yaml, patches/, or package.json
# overrides), repeat the dance — the hash is content-addressed.

let
  # pnpm needs every workspace package.json reachable at fetch time so it can
  # plan the install graph. `pnpm-workspace.yaml` lists `mcp-server` as a
  # workspace member, so its package.json must be in the source closure too.
  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../patches
      ../mcp-server/package.json
    ];
  };

  pnpmConfigMerge = import ./merge-pnpm-config.nix { inherit pkgs; };
in
pkgs.fetchPnpmDeps {
  pname = "tolaria-pnpm-deps";
  version = "0.1.0";
  inherit src;
  # Pin to pnpm 11 to match the project (package.json field implicit, lockfile
  # version 9 + v11 store layout). fetcherVersion 3 is the nixpkgs 26.11+
  # fetcher for pnpm 9/10/11.
  pnpm = pkgs.pnpm_11 or pkgs.pnpm;
  fetcherVersion = 3;
  hash = "sha256-Fger8Ia8o+woicK+AKtiYqmkkKsHqllBgDaM9U8u4Nc=";

  # Mirror pnpm.overrides + pnpm.patchedDependencies from package.json into
  # pnpm-workspace.yaml so pnpm 11's strict frozen-install reads them, and
  # raise pnpm's network timeout/concurrency so the fetcher tolerates slow
  # registry responses.
  postPatch = ''
    ${pnpmConfigMerge}
    cat > .npmrc <<'EOF'
    network-timeout=600000
    network-concurrency=4
    fetch-retries=6
    fetch-retry-mintimeout=20000
    fetch-retry-maxtimeout=120000
    EOF
  '';
}
