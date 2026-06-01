{ pkgs, lib, system, fenix, crane }:

# Rust toolchain is pinned via the `fenix` flake input in flake.lock.
# `nix flake update fenix` advances the channel reproducibly. The project's
# `rust-version = "1.77.2"` in Cargo.toml is the MSRV floor — any newer stable
# satisfies it.
let
  fenixPkgs = fenix.packages.${system};

  # Minimal toolchain crane uses to build the desktop app. Keeping rustfmt and
  # rust-analyzer out of this closure means `nix build .#tolaria` no longer
  # waits on their substitutes.
  buildToolchain = fenixPkgs.combine [
    fenixPkgs.stable.rustc
    fenixPkgs.stable.cargo
    fenixPkgs.stable.clippy
    fenixPkgs.stable.rust-src
  ];

  # Dev shell adds the IDE-only components on top.
  toolchain = fenixPkgs.combine [
    buildToolchain
    fenixPkgs.stable.rustfmt
    fenixPkgs.stable.rust-analyzer
  ];

  craneLib = (crane.mkLib pkgs).overrideToolchain buildToolchain;
in
{
  inherit toolchain craneLib;
}
