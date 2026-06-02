{ pkgs, lib, system, fenix, crane }:

# Rust toolchain is pinned via the `fenix` flake input in flake.lock.
# `nix flake update fenix` advances the channel reproducibly. The project's
# `rust-version = "1.77.2"` in Cargo.toml is the MSRV floor — any newer stable
# satisfies it.
let
  fenixPkgs = fenix.packages.${system};

  # Bare-minimum toolchain crane uses to build the desktop app.
  # `cargo build` only needs rustc + cargo; clippy / rustfmt / rust-analyzer
  # / rust-src are dev tools, not required to compile the release binary,
  # and keeping them out of this closure removes them from the build graph.
  buildToolchain = fenixPkgs.combine [
    fenixPkgs.stable.rustc
    fenixPkgs.stable.cargo
  ];

  # Dev shell adds the IDE / lint / format components on top.
  toolchain = fenixPkgs.combine [
    buildToolchain
    fenixPkgs.stable.clippy
    fenixPkgs.stable.rustfmt
    fenixPkgs.stable.rust-analyzer
    fenixPkgs.stable.rust-src
  ];

  craneLib = (crane.mkLib pkgs).overrideToolchain buildToolchain;
in
{
  inherit toolchain craneLib;
}
