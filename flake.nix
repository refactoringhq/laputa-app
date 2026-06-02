{
  description = "Tolaria — personal knowledge and life management app (Tauri 2 + React 19)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    flake-parts.url = "github:hercules-ci/flake-parts";
    flake-parts.inputs.nixpkgs-lib.follows = "nixpkgs";

    systems.url = "github:nix-systems/default";

    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";

    crane.url = "github:ipetkov/crane";

    treefmt-nix.url = "github:numtide/treefmt-nix";
    treefmt-nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs @ { flake-parts, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];

      imports = [
        inputs.treefmt-nix.flakeModule
        ./nix/treefmt.nix
      ];

      perSystem = { config, pkgs, system, lib, ... }:
        let
          rust = import ./nix/rust-toolchain.nix {
            inherit pkgs lib system;
            fenix = inputs.fenix;
            crane = inputs.crane;
          };

          isLinux = lib.hasSuffix "linux" system;

          # pnpm dependency closure — pure node files, works on every system.
          tolariaNodeModules = import ./nix/node-modules.nix {
            inherit pkgs lib;
          };

          # tolaria-mcp: stdio MCP server + ws-bridge. Pure node, cross-platform.
          tolariaMcp = import ./nix/mcp-server.nix {
            inherit pkgs lib;
            nodeModules = tolariaNodeModules;
          };

          # The bare desktop app (crane build). Linux only — WebKitGTK 4.1 stack.
          tolariaApp = if isLinux
            then import ./nix/tauri-package.nix {
              inherit pkgs lib;
              craneLib = rust.craneLib;
              nodeModules = tolariaNodeModules;
            }
            else null;

          # `tolaria` and `default` ship the desktop app + the MCP server in one
          # installable so launchers, MCP clients (Claude Desktop, Codex, ...)
          # all see the same versioned pair. `tolaria-mcp` stays exposed for
          # users who want only the server (e.g. on a remote node host).
          tolariaBundle = if isLinux
            then pkgs.symlinkJoin {
              name = "tolaria-${tolariaApp.version}";
              paths = [ tolariaApp tolariaMcp ];
              meta = tolariaApp.meta // {
                description = tolariaApp.meta.description
                  + " (bundled with tolaria-mcp server)";
              };
            }
            else null;
        in
        {
          devShells.default = import ./nix/dev-shell.nix {
            inherit pkgs lib system;
            rustToolchain = rust.toolchain;
            formatter = config.treefmt.build.wrapper;
          };

          packages = {
            tolaria-node-modules = tolariaNodeModules;
            tolaria-mcp = tolariaMcp;
          } // lib.optionalAttrs isLinux {
            tolaria = tolariaBundle;
            default = tolariaBundle;
          };
        };
    };
}
