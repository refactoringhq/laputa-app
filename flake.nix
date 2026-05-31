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

          nodeModules = lib.optionalAttrs isLinux {
            tolaria-node-modules = import ./nix/node-modules.nix {
              inherit pkgs lib;
            };
          };

          tauriPackage = lib.optionalAttrs isLinux {
            tolaria = import ./nix/tauri-package.nix {
              inherit pkgs lib;
              craneLib = rust.craneLib;
              nodeModules = nodeModules.tolaria-node-modules;
            };
          };
        in
        {
          devShells.default = import ./nix/dev-shell.nix {
            inherit pkgs lib system;
            rustToolchain = rust.toolchain;
            formatter = config.treefmt.build.wrapper;
          };

          packages = nodeModules // tauriPackage // lib.optionalAttrs isLinux {
            default = tauriPackage.tolaria;
          };
        };
    };
}
