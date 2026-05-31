{ pkgs, lib, nodeModules }:

# tolaria-mcp: stdio MCP server that exposes vault tools (search_notes,
# get_note, vault_context, ...) to AI agents. Bundles mcp-server/index.js
# and mcp-server/ws-bridge.js with esbuild into self-contained CJS so the
# only runtime requirement is `node`.
#
# Usage:
#   nix run github:refactoringhq/tolaria#tolaria-mcp
#   nix profile install github:refactoringhq/tolaria#tolaria-mcp
#
# Configure VAULT_PATH (or VAULT_PATHS) in the MCP client config:
#   {
#     "mcpServers": {
#       "tolaria": {
#         "command": "tolaria-mcp",
#         "env": { "VAULT_PATH": "/home/you/Vault" }
#       }
#     }
#   }

let
  pnpm = pkgs.pnpm_11 or pkgs.pnpm;
  pnpmConfigMerge = import ./merge-pnpm-config.nix { inherit pkgs; };

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../pnpm-lock.yaml
      ../pnpm-workspace.yaml
      ../patches
      ../scripts/bundle-mcp-server.mjs
      ../mcp-server
    ];
  };
in
pkgs.stdenv.mkDerivation {
  pname = "tolaria-mcp";
  version = "0.1.0";

  inherit src;

  nativeBuildInputs = [
    pnpm
    pkgs.nodejs_24
    pkgs.makeWrapper
  ];

  configurePhase = ''
    runHook preConfigure

    export HOME=$(mktemp -d)
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

    pnpmStore=$(mktemp -d)
    ${pkgs.zstd}/bin/zstd -d --stdout "${nodeModules}/pnpm-store.tar.zst" \
      | tar -x -C "$pnpmStore"
    chmod -R u+w "$pnpmStore"

    # pnpm 11 strict install needs overrides + patched deps in
    # pnpm-workspace.yaml; mirror them from package.json#pnpm in-place.
    ${pnpmConfigMerge}

    pnpm config set store-dir "$pnpmStore"
    pnpm install --offline --frozen-lockfile --ignore-scripts

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    # Produces src-tauri/resources/mcp-server/{index.js,ws-bridge.js,package.json}
    pnpm run bundle-mcp
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    install -d $out/share/tolaria-mcp
    install -m644 src-tauri/resources/mcp-server/index.js      $out/share/tolaria-mcp/index.js
    install -m644 src-tauri/resources/mcp-server/ws-bridge.js  $out/share/tolaria-mcp/ws-bridge.js
    install -m644 src-tauri/resources/mcp-server/package.json  $out/share/tolaria-mcp/package.json

    # tolaria-mcp -> stdio MCP server (for Claude Desktop, Codex, Gemini, etc.)
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/tolaria-mcp \
      --add-flags "$out/share/tolaria-mcp/index.js"

    # tolaria-mcp-bridge -> WebSocket bridge used by the desktop app. Exposed
    # for advanced users who want to run the bridge standalone against a
    # vault path passed via VAULT_PATH.
    makeWrapper ${pkgs.nodejs_24}/bin/node $out/bin/tolaria-mcp-bridge \
      --add-flags "$out/share/tolaria-mcp/ws-bridge.js"

    runHook postInstall
  '';

  meta = with lib; {
    description = "Tolaria MCP server — vault tools for AI agents (stdio + WebSocket bridge)";
    homepage = "https://tolaria.app";
    license = licenses.agpl3Plus;
    platforms = platforms.unix;
    mainProgram = "tolaria-mcp";
  };
}
