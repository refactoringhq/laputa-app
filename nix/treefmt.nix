{ ... }:

{
  perSystem = { ... }: {
    treefmt = {
      projectRootFile = "flake.nix";

      programs = {
        nixpkgs-fmt.enable = true;
        # rustfmt and prettier are intentionally disabled in the flake check
        # until the existing repo is cleaned up in a dedicated formatting pass.
        # Run `cargo fmt` and `pnpm format` locally in the meantime.
      };

      # Project-specific noise that should not be reformatted.
      settings.global.excludes = [
        ".direnv/**"
        "result"
        "result-*"
        "pnpm-lock.yaml"
        "Cargo.lock"
        "lara.lock"
        "flake.lock"
        "patches/**"
        "demo-vault/**"
        "demo-vault-v2/**"
        "site/.vitepress/**"
        "dist/**"
        "src-tauri/target/**"
        "src-tauri/gen/**"
        "src-tauri/resources/**"
        "release-notes/**"
        "docs/adr/**"
      ];
    };
  };
}
