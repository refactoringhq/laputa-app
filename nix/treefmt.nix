{ ... }:

{
  perSystem = { ... }: {
    treefmt = {
      projectRootFile = "flake.nix";

      programs = {
        nixpkgs-fmt.enable = true;
        rustfmt.enable = true;
        prettier = {
          enable = true;
          # Biome owns JS/TS in this repo; Prettier only handles markdown + YAML.
          includes = [ "*.md" "*.mdx" "*.yaml" "*.yml" ];
        };
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
