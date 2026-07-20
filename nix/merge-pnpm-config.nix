{ pkgs }:

# Python script that mirrors `pnpm.overrides` and `pnpm.patchedDependencies`
# from package.json into pnpm-workspace.yaml. Required because pnpm 11's
# strict frozen-install reads workspace-scoped config from
# pnpm-workspace.yaml, while this project still keeps the truth in
# package.json#pnpm. The synthesised file is consumed inside the Nix
# sandbox only; the repo source is untouched.

pkgs.writers.writePython3 "merge-pnpm-config"
{
  libraries = [ pkgs.python3Packages.pyyaml ];
} ''
  import json
  import yaml

  pkg = json.load(open("package.json"))
  pnpm_block = pkg.get("pnpm", {})

  workspace = {}
  try:
      with open("pnpm-workspace.yaml") as fh:
          workspace = yaml.safe_load(fh) or {}
  except FileNotFoundError:
      pass

  overrides = pnpm_block.get("overrides", {})
  patched = pnpm_block.get("patchedDependencies", {})

  if overrides:
      workspace.setdefault("overrides", {}).update(overrides)
  if patched:
      workspace.setdefault("patchedDependencies", {}).update(patched)

  with open("pnpm-workspace.yaml", "w") as fh:
      yaml.safe_dump(workspace, fh, sort_keys=False)
''
