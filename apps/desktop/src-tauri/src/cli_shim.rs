// `osd` on the user's PATH.
//
// The installer carries `osd` beside the app binary, so the terminal client is
// already on the machine after an install — it is just not on PATH, and the
// obvious way to put it there is broken: `osd` finds its sidecars and its
// bundled resources next to its own executable, and `current_exe()` does NOT
// resolve a symlink on macOS (measured: a symlinked `osd` reports "bundled
// OpenCode binary not found"). So what gets installed is a one-line wrapper
// that execs the real path, and nothing else.
//
// The app writes the wrapper and NEVER edits the user's PATH: telling them the
// one line to add is honest and reversible, editing their shell profile or the
// Windows registry behind their back is neither.
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Marks a wrapper as ours, so re-installing overwrites our own file and never
/// somebody else's `osd`.
const SIGNATURE: &str = "Open Science Desktop CLI wrapper";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliShimStatus {
    /// The bundled `osd` beside this executable — None in a dev run, or any
    /// build that does not carry it.
    binary: Option<String>,
    /// Where the wrapper goes, whether or not it is there yet.
    shim: String,
    /// A wrapper of ours is in place AND points at this app's `osd`.
    installed: bool,
    /// Something else occupies that name, so installing would overwrite it.
    occupied: bool,
    /// The wrapper's directory is on this process's PATH.
    on_path: bool,
    /// The line that puts it there, when it is not.
    path_hint: Option<String>,
}

/// `~/.local/bin` on every platform — one code path, and a directory the user
/// owns. Windows spells `$HOME` differently but keeps the same layout.
fn shim_dir() -> Result<PathBuf, String> {
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE")
    } else {
        std::env::var_os("HOME")
    }
    .ok_or("no home directory")?;
    Ok(PathBuf::from(home).join(".local").join("bin"))
}

fn shim_name() -> &'static str {
    if cfg!(windows) {
        "osd.cmd"
    } else {
        "osd"
    }
}

/// The bundled `osd`, when this build carries it. Tauri strips the target
/// triple when it bundles an `externalBin`, so it sits under the plain name
/// next to the app binary — the same place `osd` itself looks for `opencode`.
fn bundled_osd() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let name = if cfg!(windows) { "osd.exe" } else { "osd" };
    let path = exe.parent()?.join(name);
    path.is_file().then_some(path)
}

/// Is this a copy that will not be there tomorrow? A first-time user opens the
/// DMG and launches the app straight off the mounted image; a wrapper written
/// then would point into `/Volumes/…` and break the moment the image is
/// ejected — silently, because the file it names is simply gone.
fn runs_from_removable_image(binary: &Path) -> bool {
    cfg!(target_os = "macos") && binary.starts_with("/Volumes/")
}

/// A wrapper that execs `binary`, in the shell the platform runs.
fn wrapper_script(binary: &Path) -> String {
    let path = binary.display();
    if cfg!(windows) {
        format!(
            "@echo off\r\n\
             rem {SIGNATURE}. A wrapper, not a symlink: osd finds its sidecars\r\n\
             rem and bundled resources next to the real executable.\r\n\
             \"{path}\" %*\r\n"
        )
    } else {
        format!(
            "#!/bin/sh\n\
             # {SIGNATURE}. A wrapper, not a symlink: osd finds its sidecars and\n\
             # bundled resources next to the real executable, and macOS does not\n\
             # resolve a symlink for current_exe().\n\
             exec \"{path}\" \"$@\"\n"
        )
    }
}

/// Is `dir` on this process's PATH? Compared as paths, so a trailing separator
/// or a different spelling of the same directory still counts.
fn on_path(dir: &Path) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|entry| entry == dir)
}

/// The line that adds `dir` to PATH, for the platform's shell.
fn path_hint(dir: &Path) -> String {
    let dir = dir.display();
    if cfg!(windows) {
        // Reads the USER PATH and writes it back with the directory appended.
        // `setx` is deliberately not used: it truncates a PATH longer than
        // 1024 characters, which destroys the variable it was meant to extend.
        format!(
            "[Environment]::SetEnvironmentVariable('PATH', \
             [Environment]::GetEnvironmentVariable('PATH','User') + ';{dir}', 'User')"
        )
    } else {
        format!("export PATH=\"{dir}:$PATH\"")
    }
}

fn status_for(binary: Option<PathBuf>, shim: &Path) -> CliShimStatus {
    let existing = std::fs::read_to_string(shim).ok();
    let ours = existing.as_deref().is_some_and(|t| t.contains(SIGNATURE));
    let points_here = match (&existing, &binary) {
        (Some(text), Some(bin)) => ours && text.contains(&bin.display().to_string()),
        _ => false,
    };
    let dir = shim.parent().unwrap_or(shim);
    let has_path = on_path(dir);
    CliShimStatus {
        binary: binary.map(|b| b.display().to_string()),
        shim: shim.display().to_string(),
        installed: points_here,
        occupied: existing.is_some() && !ours,
        on_path: has_path,
        path_hint: (!has_path).then(|| path_hint(dir)),
    }
}

/// Where `osd` is and whether the wrapper is in place. Cheap enough to call on
/// every render of the settings card.
#[tauri::command]
pub fn cli_shim_status() -> Result<CliShimStatus, String> {
    let shim = shim_dir()?.join(shim_name());
    Ok(status_for(bundled_osd(), &shim))
}

/// Write the wrapper, and report the state afterwards — including whether the
/// user still has to add the directory to PATH.
#[tauri::command]
pub fn install_cli_shim() -> Result<CliShimStatus, String> {
    let binary = bundled_osd().ok_or("this build does not carry the osd command")?;
    if runs_from_removable_image(&binary) {
        return Err("this copy is running from the disk image — drag Open Science into \
                    Applications, open it from there, and install the command again"
            .into());
    }
    let dir = shim_dir()?;
    let shim = dir.join(shim_name());
    // Never overwrite a file that is not ours — a user with their own `osd` on
    // PATH gets told, not clobbered.
    if let Ok(text) = std::fs::read_to_string(&shim) {
        if !text.contains(SIGNATURE) {
            return Err(format!("{} already exists and is not ours", shim.display()));
        }
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&shim, wrapper_script(&binary)).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&shim, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(status_for(Some(binary), &shim))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_wrapper_execs_the_real_binary_and_never_symlinks_it() {
        let script = wrapper_script(Path::new("/Applications/Open Science.app/Contents/MacOS/osd"));
        assert!(script.contains("/Applications/Open Science.app/Contents/MacOS/osd"));
        assert!(script.contains(SIGNATURE), "a re-install must recognise its own file");
        if cfg!(windows) {
            assert!(script.starts_with("@echo off"), "{script}");
            assert!(script.contains("%*"), "arguments must reach osd: {script}");
        } else {
            assert!(script.starts_with("#!/bin/sh"), "{script}");
            assert!(script.contains("exec \""), "{script}");
            assert!(script.contains("\"$@\""), "arguments must reach osd: {script}");
        }
    }

    #[test]
    fn status_tells_ours_from_a_stranger_and_from_a_stale_wrapper() {
        let tmp = std::env::temp_dir().join(format!("cli-shim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let shim = tmp.join(shim_name());
        let binary = tmp.join("app/osd");

        // Nothing there yet.
        let s = status_for(Some(binary.clone()), &shim);
        assert!(!s.installed && !s.occupied);

        // Somebody else's osd: reported, and install refuses rather than
        // overwriting it.
        std::fs::write(&shim, "#!/bin/sh\necho not ours\n").unwrap();
        let s = status_for(Some(binary.clone()), &shim);
        assert!(s.occupied && !s.installed);

        // A wrapper of ours from a PREVIOUS install location is not "installed":
        // the app has moved, and the button must offer to point it here again.
        std::fs::write(&shim, wrapper_script(Path::new("/old/path/osd"))).unwrap();
        let s = status_for(Some(binary.clone()), &shim);
        assert!(!s.occupied, "our own file is never 'occupied'");
        assert!(!s.installed, "a wrapper pointing elsewhere is not installed");

        // Ours, pointing here.
        std::fs::write(&shim, wrapper_script(&binary)).unwrap();
        let s = status_for(Some(binary), &shim);
        assert!(s.installed && !s.occupied);

        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn a_copy_running_from_the_disk_image_is_refused() {
        // The wrapper would name a path that disappears when the image is
        // ejected, and `osd` would then be "installed" and missing at once.
        if cfg!(target_os = "macos") {
            assert!(runs_from_removable_image(Path::new(
                "/Volumes/Open Science/Open Science.app/Contents/MacOS/osd"
            )));
        }
        assert!(!runs_from_removable_image(Path::new(
            "/Applications/Open Science.app/Contents/MacOS/osd"
        )));
    }

    #[test]
    fn the_path_hint_never_uses_setx() {
        // setx truncates a PATH over 1024 characters — it would destroy the
        // variable it was meant to extend.
        let hint = path_hint(Path::new("/home/u/.local/bin"));
        assert!(!hint.to_lowercase().contains("setx"), "{hint}");
        assert!(hint.contains("/home/u/.local/bin"), "{hint}");
    }

    #[test]
    fn a_directory_on_path_is_recognised_however_it_is_spelled() {
        let dir = std::env::temp_dir().join("osd-path-probe");
        let joined = std::env::join_paths([dir.clone(), PathBuf::from("/usr/bin")]).unwrap();
        // SAFETY: single-threaded test process, and the value is restored below.
        let previous = std::env::var_os("PATH");
        unsafe { std::env::set_var("PATH", &joined) };
        assert!(on_path(&dir));
        assert!(!on_path(Path::new("/definitely/not/on/path")));
        match previous {
            Some(v) => unsafe { std::env::set_var("PATH", v) },
            None => unsafe { std::env::remove_var("PATH") },
        }
    }
}
