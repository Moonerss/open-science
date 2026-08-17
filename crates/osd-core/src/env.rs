// Where the app is on disk, and nothing else.
//
// Every function that used to take a Tauri `AppHandle` only ever asked it three
// questions: where is my data directory, where are my bundled resources, and
// what version am I. `Env` answers those three without a window — which is what
// lets the same code serve the desktop app and `osd server` on a machine with no
// display at all.
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::runtime::RuntimeState;

/// The bundle identifier every platform's data directory is named after. It is
/// the same string as `tauri.conf.json`'s `identifier`, and it MUST stay that
/// way: `osd` and the desktop app share one runtime root, so a session started
/// in one is visible in the other.
pub const IDENTIFIER: &str = "com.ai4s.workbench";

struct Inner {
    data_dir: PathBuf,
    resource_dir: PathBuf,
    document_dir: Option<PathBuf>,
    version: String,
    runtime: RuntimeState,
}

/// Cheap to clone (one `Arc`), so it can be handed to threads and stored in
/// Tauri state without ceremony.
#[derive(Clone)]
pub struct Env(Arc<Inner>);

impl Env {
    pub fn new(
        data_dir: PathBuf,
        resource_dir: PathBuf,
        document_dir: Option<PathBuf>,
        version: String,
    ) -> Self {
        Env(Arc::new(Inner {
            data_dir,
            resource_dir,
            document_dir,
            version,
            runtime: RuntimeState::default(),
        }))
    }

    /// The headless layout: the platform data dir Tauri would have chosen, and
    /// resources next to the executable. `osd` ships as a directory —
    /// `osd`, `opencode`, `resources/` — so a compute node needs no installer.
    pub fn headless(resource_dir: Option<PathBuf>, version: String) -> Result<Self, String> {
        let data_dir = platform_data_dir()?;
        let resource_dir = match resource_dir {
            Some(d) => d,
            None => default_resource_dir()?,
        };
        Ok(Env::new(data_dir, resource_dir, platform_document_dir(), version))
    }

    /// `<data dir>` — e.g. `~/Library/Application Support/com.ai4s.workbench`.
    pub fn data_dir(&self) -> &Path {
        &self.0.data_dir
    }

    /// A bundled resource by its name inside the resource directory
    /// (`goal-plugin`, `skills-core`, …), or None when this build does not
    /// carry it — a dev run without the fetch scripts, say.
    pub fn resource(&self, rel: &str) -> Option<PathBuf> {
        let p = self.0.resource_dir.join(rel);
        p.exists().then_some(p)
    }

    pub fn resource_dir(&self) -> &Path {
        &self.0.resource_dir
    }

    /// The user's Documents folder, when the platform has one. The default
    /// workspace lives under it.
    pub fn document_dir(&self) -> Option<PathBuf> {
        self.0.document_dir.clone()
    }

    pub fn version(&self) -> &str {
        &self.0.version
    }

    /// The OpenCode sidecar's lifecycle. One per `Env`, so the gateway and the
    /// commands that start/stop the runtime are talking about the same process.
    pub fn runtime(&self) -> &RuntimeState {
        &self.0.runtime
    }
}

/// The per-user application data directory, matching what Tauri's
/// `app_data_dir()` resolves to on each platform — the desktop app and `osd`
/// must land on the SAME directory or they would each keep their own sessions.
fn platform_data_dir() -> Result<PathBuf, String> {
    let base = if cfg!(target_os = "macos") {
        home()?.join("Library").join("Application Support")
    } else if cfg!(target_os = "windows") {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .ok_or_else(|| "APPDATA is not set".to_string())?
    } else {
        match std::env::var_os("XDG_DATA_HOME").filter(|v| !v.is_empty()) {
            Some(v) => PathBuf::from(v),
            None => home()?.join(".local").join("share"),
        }
    };
    Ok(base.join(IDENTIFIER))
}

fn platform_document_dir() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents"));
    }
    // XDG's Documents entry when the user configured one, else the usual name.
    // No new dependency: this is two lines of ini, and being wrong only costs
    // the default workspace a less pretty location.
    if let Some(dir) = xdg_documents_dir() {
        return Some(dir);
    }
    home().ok().map(|h| h.join("Documents"))
}

fn xdg_documents_dir() -> Option<PathBuf> {
    let config = match std::env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()) {
        Some(v) => PathBuf::from(v),
        None => home().ok()?.join(".config"),
    };
    let text = std::fs::read_to_string(config.join("user-dirs.dirs")).ok()?;
    let raw = text.lines().find_map(|l| {
        l.trim()
            .strip_prefix("XDG_DOCUMENTS_DIR=")
            .map(|v| v.trim_matches('"').to_string())
    })?;
    let expanded = match raw.strip_prefix("$HOME/") {
        Some(rest) => home().ok()?.join(rest),
        None => PathBuf::from(raw),
    };
    expanded.is_dir().then_some(expanded)
}

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "could not resolve the home directory".to_string())
}

/// Resources next to the executable: `<exe dir>/resources` when `osd` was
/// unpacked from its tarball, or `<exe dir>/../Resources` inside a macOS app
/// bundle (so `osd` placed in an installed app's MacOS directory just works).
fn default_resource_dir() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "executable has no parent directory".to_string())?;
    for candidate in [dir.join("resources"), dir.join("../Resources")] {
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }
    // Not an error: a build with no bundled resources still runs, it just has
    // no skill packs to deploy. `Env::resource` returns None for each of them.
    Ok(dir.join("resources"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn data_dir_is_identifier_scoped() {
        let dir = platform_data_dir().expect("a home directory in the test env");
        assert!(dir.ends_with(IDENTIFIER), "{dir:?} must be the app's own directory");
    }

    #[test]
    fn missing_resources_resolve_to_none() {
        let env = Env::new(
            PathBuf::from("/nonexistent/data"),
            PathBuf::from("/nonexistent/resources"),
            None,
            "0.0.0".into(),
        );
        assert_eq!(env.resource("skills-core"), None);
    }
}
