use zed::serde_json::{json, Value};
use zed::settings::LspSettings;
use zed_extension_api as zed;

struct XoExtension;

impl zed::Extension for XoExtension {
    /// Creates the stateless adapter. All lint state stays in the existing Node
    /// server, so the extension only supplies its launch command and settings.
    fn new() -> Self {
        Self
    }

    /// Starts this checkout's server rather than downloading another copy.
    /// The checkout path is captured at compile time because the extension's
    /// runtime working directory is not the repository. Moving the checkout
    /// requires rebuilding the dev extension; this is deliberately local-only.
    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let node = worktree
            .which("node")
            .ok_or("XO requires Node 22+ on Zed's shell PATH.")?;

        Ok(zed::Command {
            command: node,
            args: vec![
                concat!(env!("CARGO_MANIFEST_DIR"), "/../dist/server.js").into(),
                "--stdio".into(),
            ],
            env: worktree.shell_env(),
        })
    }

    /// Supplies the configuration section requested by the existing server.
    /// VS Code normally supplies the enable default through its manifest;
    /// Zed needs it here. Explicit user settings, including enable=false,
    /// take precedence, and the remaining optional fields keep server defaults.
    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<Option<Value>> {
        let mut settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?
            .settings
            .unwrap_or_else(|| json!({}));
        let sections = settings
            .as_object_mut()
            .ok_or("lsp.xo.settings must be an object.")?;
        let xo = sections.entry("xo").or_insert_with(|| json!({}));
        let xo = xo
            .as_object_mut()
            .ok_or("lsp.xo.settings.xo must be an object.")?;
        xo.entry("enable").or_insert(json!(true));

        Ok(Some(settings))
    }
}

zed::register_extension!(XoExtension);
