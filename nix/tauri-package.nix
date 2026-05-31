{ pkgs, lib, craneLib, nodeModules }:

# Builds the Tolaria desktop binary via crane:
#   1. Install the pre-fetched pnpm store into ./node_modules.
#   2. Run `pnpm build` to produce dist/ (Vite + tsc).
#   3. Run `cargo tauri build --no-bundle` from src-tauri/.
#   4. Install the resulting `tolaria` binary and wrap it with the GTK/WebKit
#      runtime closure so it can launch outside the devShell.
#
# AppImage/deb/dmg bundling stays on GitHub Actions. This derivation produces
# a runnable binary for `nix run .#tolaria`, which is the realistic goal for
# Nix users.

let
  # nodeModules was produced by fetchPnpmDeps with pnpm 11 (v11 store format);
  # consume it with the matching pnpm major.
  pnpm = pkgs.pnpm_11 or pkgs.pnpm;
  pnpmConfigMerge = import ./merge-pnpm-config.nix { inherit pkgs; };

  # `tauri/custom-protocol` flips Tauri from dev to production at runtime
  # (tauri::is_dev() == !cfg!(feature = "custom-protocol")). Without it, the
  # release binary still loads from `devUrl` and shows "Could not connect to
  # localhost". `cargo tauri build` sets it automatically; raw cargo does not.
  cargoBuildArgs = "--release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml";

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../tsconfig.json
      ../tsconfig.app.json
      ../tsconfig.node.json
      ../vite.config.ts
      ../index.html
      ../biome.json
      ../eslint.config.js
      ../components.json
      ../patches
      ../public
      ../src
      ../src-tauri
      ../scripts
      ../mcp-server
      # site/ is needed by `pnpm agent-docs` (build-agent-docs.mjs reads
      # markdown there to generate the bundled agent-docs resource).
      ../site
    ];
  };

  cargoArtifacts = craneLib.buildDepsOnly {
    pname = "tolaria-deps";
    version = "0.1.0";
    src = craneLib.cleanCargoSource ../src-tauri;
    cargoToml = ../src-tauri/Cargo.toml;
    cargoLock = ../src-tauri/Cargo.lock;
    strictDeps = true;
    nativeBuildInputs = nativeBuildInputs;
    buildInputs = buildInputs;
  };

  nativeBuildInputs = with pkgs; [
    pkg-config
    pnpm
    pkgs.nodejs_24
    pkgs.cargo-tauri
    clang
    cmake
    python3
    wrapGAppsHook3
  ];

  buildInputs = with pkgs; [
    webkitgtk_4_1
    libsoup_3
    gtk3
    glib
    openssl
    dbus
    cairo
    pango
    harfbuzz
    freetype
    fontconfig
    gdk-pixbuf
    librsvg
    libayatana-appindicator
  ];

  # External binaries Tolaria shells out to at runtime:
  #   - xdg-utils:        xdg-mime + xdg-open for URI-scheme registration and opener fallback
  #   - desktop-file-utils: update-desktop-database, called by deep-link's register()
  #   - git:              vault git operations
  #   - nodejs_24:        runs the bundled mcp-server/ws-bridge sidecar (see mcp::find_node)
  runtimeBins = with pkgs; [
    xdg-utils
    desktop-file-utils
    git
    pkgs.nodejs_24
  ];

  runtimeLibs = with pkgs; [
    webkitgtk_4_1
    libsoup_3
    gtk3
    glib
    openssl
    dbus
    cairo
    pango
    harfbuzz
    fontconfig
    freetype
    gdk-pixbuf
    librsvg
    libayatana-appindicator
    libGL
    mesa
  ];
in
craneLib.buildPackage {
  pname = "tolaria";
  version = "0.1.0";

  inherit src cargoArtifacts nativeBuildInputs buildInputs;

  cargoToml = ../src-tauri/Cargo.toml;
  cargoLock = ../src-tauri/Cargo.lock;

  # Crane defaults to building from $src root with cargo. Tauri's Cargo manifest
  # lives in src-tauri/, and `cargo tauri build` wraps cargo with the frontend
  # build pipeline.
  cargoExtraArgs = "--manifest-path src-tauri/Cargo.toml";
  doCheck = false;

  # We supply our own installPhaseCommand below — bypass crane's automatic
  # binary detection (which expects a JSON-formatted cargo build log).
  doNotPostBuildInstallCargoBinaries = true;

  preConfigure = ''
    # fetchPnpmDeps v3 emits a content-addressed pnpm store, not a flat
    # node_modules tree. Mirror it into a writable scratch dir, point pnpm
    # at it, and run an offline install so the workspace gets a normal
    # node_modules with .bin scripts (tsc, vite, etc.).
    export HOME=$(mktemp -d)
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    pnpmStore=$(mktemp -d)
    # fetcherVersion 3 ships the pnpm store as a single zstd tarball.
    ${pkgs.zstd}/bin/zstd -d --stdout "${nodeModules}/pnpm-store.tar.zst" \
      | tar -x -C "$pnpmStore"
    chmod -R u+w "$pnpmStore"

    # Same fix as in node-modules.nix: pnpm 11 reads workspace config from
    # pnpm-workspace.yaml, mirror the pnpm.overrides and patchedDependencies
    # blocks from package.json so the frozen install matches the lockfile.
    ${pnpmConfigMerge}

    pnpm config set store-dir "$pnpmStore"
    pnpm install --offline --frozen-lockfile --ignore-scripts
  '';

  buildPhaseCargoCommand = ''
    # Mirror tauri.conf.json's `beforeBuildCommand`:
    #   pnpm build && pnpm bundle-mcp && pnpm agent-docs
    # Each writes into src-tauri/resources/ (mcp-server bundles, agent docs)
    # or dist/ (Vite output) before cargo packages them as bundled resources.
    pnpm run build
    pnpm run bundle-mcp
    pnpm run agent-docs
    cargo build ${cargoBuildArgs}
  '';

  installPhaseCommand = ''
    runHook preInstall

    install -Dm755 src-tauri/target/release/tolaria $out/bin/tolaria

    # Desktop entry + icon so `nix run .#tolaria` integrates with launchers.
    install -Dm644 src-tauri/icons/icon.png \
      $out/share/icons/hicolor/512x512/apps/club.refactoring.tolaria.png || true

    runHook postInstall
  '';

  postFixup = ''
    wrapProgram $out/bin/tolaria \
      --prefix LD_LIBRARY_PATH : "${lib.makeLibraryPath runtimeLibs}" \
      --prefix PATH : "${lib.makeBinPath runtimeBins}" \
      --set WEBKIT_DISABLE_DMABUF_RENDERER 1
  '';

  meta = with lib; {
    description = "Personal knowledge and life management app (Tauri 2)";
    homepage = "https://tolaria.app";
    license = licenses.agpl3Plus;
    platforms = platforms.linux;
    mainProgram = "tolaria";
  };
}
