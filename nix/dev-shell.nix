{ pkgs, lib, system, rustToolchain, formatter }:

let
  isLinux = lib.hasSuffix "linux" system;
  isDarwin = lib.hasSuffix "darwin" system;

  # Tools every dev needs regardless of OS.
  commonPackages = [
    rustToolchain
    formatter

    pkgs.nodejs_24
    pkgs.corepack_24
    pkgs.cargo-tauri

    pkgs.pkg-config
    pkgs.git

    # Frontend tooling reachable without `pnpm exec`.
    pkgs.biome
  ];

  # GTK / WebKit2GTK 4.1 (libsoup3) stack required by Tauri 2 on Linux,
  # plus Wayland + X11 + fonts/themes so the dev window actually renders.
  linuxRuntime = with pkgs; [
    webkitgtk_4_1
    libsoup_3
    gtk3
    glib
    gobject-introspection
    gsettings-desktop-schemas

    openssl
    dbus

    cairo
    pango
    harfbuzz
    freetype
    fontconfig
    gdk-pixbuf
    librsvg

    wayland
    wayland-protocols
    libxkbcommon

    libx11
    libxcursor
    libxi
    libxrandr
    libxrender
    libxtst

    libGL
    mesa

    adwaita-icon-theme
    hicolor-icon-theme
    gnome-themes-extra

    libnotify
    libayatana-appindicator
  ];

  linuxBuildTools = with pkgs; [
    clang
    llvmPackages.libclang
    cmake
    python3
    desktop-file-utils
  ];

  # macOS frameworks Tauri needs are provided by the host Xcode CLT, not Nix —
  # this shell only supplies the language toolchains and helpers.
  darwinBanner = ''
    echo
    echo "Tolaria devShell (Darwin) — Nix provides Node, pnpm, Rust, and cargo-tauri."
    echo "Tauri's macOS frameworks come from Xcode Command Line Tools:"
    echo "  $ xcode-select --install"
    echo
  '';

  linuxShellHook = ''
    # WebKitGTK + GIO module discovery on NixOS.
    export GIO_MODULE_DIR="${pkgs.glib}/lib/gio/modules"
    export XDG_DATA_DIRS="${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.hicolor-icon-theme}/share:${pkgs.adwaita-icon-theme}/share:${pkgs.gnome-themes-extra}/share:''${XDG_DATA_DIRS:-/usr/local/share:/usr/share}"

    # Avoids WebKitGTK 4.1 black-window / crash on NVidia + Wayland.
    export WEBKIT_DISABLE_DMABUF_RENDERER=1
    export GDK_BACKEND="''${GDK_BACKEND:-wayland,x11}"

    # bindgen-using crates (e.g. some Tauri plugins) need libclang at runtime.
    export LIBCLANG_PATH="${pkgs.llvmPackages.libclang.lib}/lib"

    echo
    echo "Tolaria devShell ready (Linux)."
    echo "  pnpm install         # node_modules with patches + overrides"
    echo "  pnpm tauri dev       # run the desktop app"
    echo "  nix build .#tolaria  # build the wrapped binary via Nix"
    echo
  '';

  commonShellHook = ''
    # corepack manages the project-pinned pnpm version (package.json packageManager
    # or fallback to system default). Keep its shims out of $HOME.
    export COREPACK_HOME="$PWD/.direnv/corepack"
    export PNPM_HOME="$PWD/.direnv/pnpm"
    export PATH="$PNPM_HOME:$PATH"
    mkdir -p "$COREPACK_HOME" "$PNPM_HOME"
  '';
in
pkgs.mkShell {
  name = "tolaria-dev";

  packages = commonPackages
    ++ lib.optionals isLinux (linuxRuntime ++ linuxBuildTools);

  shellHook = commonShellHook
    + lib.optionalString isLinux linuxShellHook
    + lib.optionalString isDarwin darwinBanner;
}
