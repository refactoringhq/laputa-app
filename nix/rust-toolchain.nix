{ pkgs, lib, system, fenix, crane }:

# Rust toolchain is pinned via the `fenix` flake input in flake.lock.
# `nix flake update fenix` advances the channel reproducibly. The project's
# `rust-version = "1.77.2"` in Cargo.toml is the MSRV floor — any newer stable
# satisfies it.
let
  fenixPkgs = fenix.packages.${system};

  toolchain = fenixPkgs.combine [
    fenixPkgs.stable.rustc
    fenixPkgs.stable.cargo
    fenixPkgs.stable.clippy
    fenixPkgs.stable.rustfmt
    fenixPkgs.stable.rust-analyzer
    fenixPkgs.stable.rust-src
  ];

  craneLib = (crane.mkLib pkgs).overrideToolchain toolchain;
in
{
  inherit toolchain craneLib;
}
