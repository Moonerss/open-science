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
    #[cfg(windows)]
    {
        return windows_documents_dir()
            .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents")));
    }
    #[cfg(not(windows))]
    {
    // XDG's Documents entry when the user configured one, else the usual name.
    // No new dependency: this is two lines of ini, and being wrong only costs
    // the default workspace a less pretty location.
    if let Some(dir) = xdg_documents_dir() {
        return Some(dir);
    }
    home().ok().map(|h| h.join("Documents"))
    }
}

/// Windows' real Documents folder, which is NOT always `%USERPROFILE%\Documents`
/// — OneDrive redirects it, and then the two front doors would each invent their
/// own default workspace on the same machine. Tauri resolves it through
/// `SHGetKnownFolderPath`; without that dependency here, the same answer comes
/// from the registry value Explorer keeps in sync with it.
///
/// The value is a `REG_EXPAND_SZ`, so it can contain `%VAR%` (measured on a real
/// Windows 11 box: `Personal    REG_EXPAND_SZ    %USERPROFILE%\Documents`), and
/// the path itself may contain spaces — hence splitting on the type token rather
/// than on whitespace.
#[cfg(windows)]
fn windows_documents_dir() -> Option<PathBuf> {
    let out = crate::runtime::quiet_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            "/v",
            "Personal",
        ])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout).into_owned();
    let raw = registry_value(&text, "Personal")?;
    let expanded = expand_env_vars(&raw);
    let path = PathBuf::from(expanded);
    path.is_dir().then_some(path)
}

/// The value of `name` in `reg query` output, keeping any spaces in it.
#[cfg(any(windows, test))]
fn registry_value(text: &str, name: &str) -> Option<String> {
    text.lines()
        .filter(|l| l.trim_start().starts_with(name))
        .find_map(|line| {
            let (_, rest) = line.split_once("REG_EXPAND_SZ").or_else(|| line.split_once("REG_SZ"))?;
            let value = rest.trim();
            (!value.is_empty()).then(|| value.to_string())
        })
}

/// Expand `%VAR%` references the way `REG_EXPAND_SZ` intends. An unset variable
/// is left as written, so a wrong guess is visible rather than silently becoming
/// a path relative to nothing.
#[cfg(any(windows, test))]
fn expand_env_vars(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(value) => out.push_str(&value),
                    Err(_) => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Not compiled on Windows, which asks the registry instead — otherwise every
/// Windows build warns it is dead code.
#[cfg(not(windows))]
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
    fn windows_documents_come_from_the_registry_value() {
        // Verbatim shape of `reg query ... /v Personal` on Windows 11, plus the
        // OneDrive-redirected form — where `%USERPROFILE%\Documents` would be
        // the WRONG answer and the desktop app (which asks Windows itself)
        // would disagree with us about where the workspace lives.
        let plain = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders\r\n    Personal    REG_EXPAND_SZ    %USERPROFILE%\\Documents\r\n";
        assert_eq!(
            registry_value(plain, "Personal").as_deref(),
            Some("%USERPROFILE%\\Documents")
        );
        // A redirected path keeps its spaces.
        let onedrive = "    Personal    REG_SZ    C:\\Users\\a\\OneDrive - Contoso Ltd\\Documents\r\n";
        assert_eq!(
            registry_value(onedrive, "Personal").as_deref(),
            Some("C:\\Users\\a\\OneDrive - Contoso Ltd\\Documents")
        );
        assert_eq!(registry_value("nothing here", "Personal"), None);

        std::env::set_var("OSD_TEST_PROFILE", "C:\\Users\\a");
        assert_eq!(expand_env_vars("%OSD_TEST_PROFILE%\\Documents"), "C:\\Users\\a\\Documents");
        // An unset variable stays visible instead of silently vanishing.
        assert_eq!(expand_env_vars("%OSD_NOT_SET%\\x"), "%OSD_NOT_SET%\\x");
        assert_eq!(expand_env_vars("no vars here"), "no vars here");
        assert_eq!(expand_env_vars("50% done"), "50% done");
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
