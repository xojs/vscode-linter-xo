# Local XO extension for Zed

This prototype launches `../dist/server.js` from this checkout using Node on
Zed's shell PATH. It registers a second language server for JavaScript,
TypeScript, and TSX; it does not replace Zed's existing language support.

## Build and install

From the repository root:

```sh
npm ci
npm run build

# Zed needs a rustup-managed Rust toolchain with the WASI target.
# If rustup has no default toolchain yet:
rustup toolchain install stable
rustup default stable
rustup target add wasm32-wasip2

# Optional preflight; Zed also compiles when installing a dev extension.
RUSTC="$(rustup which --toolchain stable rustc)" \
  rustup run stable cargo build --manifest-path zed/Cargo.toml \
  --target wasm32-wasip2 --release
```

Homebrew's standalone `rustc`/`cargo` are not necessarily the rustup-managed
ones. Even `rustup run stable cargo` can select Homebrew's compiler in this
setup, so the command above explicitly selects the compiler with the installed
WASI target. The output is `zed/target/wasm32-wasip2/release/zed_xo.wasm`.

If Zed's dev-extension build also reports a missing target, fully quit Zed and
launch it with the same compiler selection before installing:

```sh
RUSTC="$(rustup which --toolchain stable rustc)" zed --foreground .
```

This sets the compiler for that launch only; it does not alter your global Rust
configuration.

Alternatively, pin the compiler for this dev extension using a machine-local
Cargo config. Zed runs Cargo from `zed/`, so it reads this file without requiring
an editor restart:

```sh
mkdir -p zed/.cargo
printf '[build]\nrustc = "%s"\n\n[env]\nDYLD_LIBRARY_PATH = "%s/lib"\n' \
  "$(rustup which --toolchain stable rustc)" \
  "$(rustup run stable rustc --print sysroot)" > zed/.cargo/config.toml
```

`zed/.cargo/config.toml` is git-ignored because it contains your absolute toolchain
path. The library search path lets Homebrew Cargo's build subprocesses find the
rustup linker's `libLLVM.dylib` on macOS. It affects builds run from `zed/`, not
builds using `--manifest-path` from
the repository root. Delete it to revert the local compiler selection.

In Zed, run **zed: install dev extension** from the command palette and select
this repo's **`zed/` directory**, not the repository root. Installation requires
access to crates.io and Rust toolchain downloads.

Open a project that declares XO in `dependencies` or `devDependencies` and has
its dependencies installed. Node must be version 22+ and satisfy that project's
XO runtime requirements. This repository itself is a suitable project.

## Enable and try it

Add the following to that project's `.zed/settings.json` (or your user settings):

```json
{
  "languages": {
    "JavaScript": { "language_servers": ["xo", "..."] },
    "TypeScript": { "language_servers": ["xo", "..."] },
    "TSX": { "language_servers": ["xo", "..."] }
  }
}
```

The `...` keeps the other registered servers. If ESLint is also enabled, use
`["xo", "!eslint", "..."]` to avoid duplicate lint diagnostics.

Open a JavaScript file inside the project, enter `const unused = 1;`, and wait
for XO diagnostics. Use **editor: toggle code actions** on a fixable problem to
try a quick fix. Remove the scratch file when finished. Linting runs on open
buffers and changes; this is not a whole-project lint command.

XO is enabled by default. Optional settings use the server's existing `xo`
section, for example:

```json
{
  "lsp": {
    "xo": {
      "settings": {
        "xo": {
          "enable": true,
          "format": { "enable": true }
        }
      }
    }
  },
  "languages": {
    "JavaScript": {
      "language_servers": ["xo", "..."],
      "formatter": { "language_server": { "name": "xo" } }
    }
  }
}
```

Formatting is optional and is off unless `xo.format.enable` is true. Fix-all
code actions are advertised by the server, but their behavior in Zed still needs
verification; start with diagnostics and individual fixes.

## Iterate and troubleshoot

- After changing the Node server, run `npm run build` and restart the language
  server in Zed.
- After changing the Rust adapter or manifest, rebuild the dev extension using
  the Extensions page.
- After changing XO config files or project dependencies, restart the language
  server. The VS Code client's file watchers are not part of this prototype.
- Inspect **zed: open log** and Zed's language-server logs for startup errors.
- `node /absolute/path/to/this/repo/dist/server.js --stdio` should start without
  an immediate module-resolution error. It waits for LSP messages, so no terminal
  output is expected; stop it with Ctrl-C.

The absolute checkout location is baked into the extension at compile time.
Keep this checkout in place while testing, and rebuild the dev extension if you
move it. This is not a distributable extension: it has no server downloads,
Node installation, automatic config-file watching, or custom XO editor UI.
Project XO and its config execute code, so only use it with trusted projects.
