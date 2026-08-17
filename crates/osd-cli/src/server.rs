// `osd server` — the workbench with no window.
//
// Same core the desktop runs: the same workspace, the same OpenCode sidecar,
// the same gateway, the same web client. What is missing is only what needs a
// screen (local Jupyter kernels, native dialogs, the OS file manager), and the
// web client already hides those.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use osd_core::gateway::{self, GatewayState};
use osd_core::runtime;

use crate::args::Args;
use crate::assets;

pub fn run(args: &Args) -> Result<(), String> {
    let env = crate::env(args)?;

    // A workspace named on the command line becomes the active one, exactly as
    // picking a folder in the app does — so `osd server --workspace ~/proj`
    // opens on that folder and the sidecar starts inside it.
    if let Some(dir) = args.value("workspace") {
        let path = PathBuf::from(&dir);
        let absolute = if path.is_absolute() {
            path
        } else {
            std::env::current_dir().map_err(|e| e.to_string())?.join(path)
        };
        let chosen = runtime::set_workspace(&env, absolute.to_string_lossy().to_string())?;
        osd_core::git_snapshot::watch_workspace(std::path::Path::new(&chosen));
    }

    // Bind first, config second: everything below is written to disk, and a
    // refusal after that would leave the machine configured for a server that
    // never came up.
    let lan = args.has("lan") || matches!(args.value("host").as_deref(), Some("0.0.0.0"));
    let mode = match args.value("mode").as_deref() {
        None | Some("full") => "full".to_string(),
        Some("read-only") => "read-only".to_string(),
        Some(other) => return Err(format!("unknown --mode {other:?} (full or read-only)")),
    };

    // The token is stored (it has to survive a restart, and a client on this
    // machine finds it there); the binding and the access mode are this run's
    // and are NOT written over the desktop app's own settings.
    let token = gateway::ensure_token(&env, args.value("token"))?;
    let mut persisted = gateway::read_persisted(&env);
    persisted.token = token.clone();
    persisted.lan = lan;
    persisted.mode = mode.clone();
    let requested_port = args
        .value("port")
        .map(|p| p.parse::<u16>().map_err(|_| format!("invalid --port {p:?}")))
        .transpose()?;

    let state = GatewayState::new(Arc::new(assets::Embedded), None);

    // The sidecar first, so the gateway never answers a request with "runtime
    // not started" during the first seconds.
    eprintln!("Starting the agent runtime…");
    let sidecar = runtime::start_runtime(&env)?;

    let port = gateway::start_at(&env, &state, &persisted, requested_port)?;
    let workspace = runtime::workspace_dir(&env)?;

    if assets::is_empty() {
        eprintln!("note: this build carries no web client; /v1 is served, / is not.");
    }
    println!("Open Science Desktop — headless\n");
    println!("  workspace   {}", workspace.display());
    println!("  runtime     {sidecar}");
    println!("  access      {mode}");
    println!("  url         http://{}:{port}", if lan { "0.0.0.0" } else { "127.0.0.1" });
    if lan {
        if let Some(ip) = local_ip() {
            println!("  on the LAN  http://{ip}:{port}/?token={token}");
        }
    }
    println!("  token       {token}");
    println!("\nOpen the URL with ?token=<token>, or point a CLI at it:");
    println!("  osd --gateway http://127.0.0.1:{port} --token {token} session ls");
    println!("\nCtrl-C to stop.");

    wait_for_shutdown();

    eprintln!("\nStopping…");
    gateway::shutdown(&env, &state);
    runtime::kill_child(env.runtime());
    Ok(())
}

/// Block until the process is asked to stop.
///
/// On Unix the sidecar shares this process group, so a terminal Ctrl-C already
/// reaches it — but a `kill` (systemd, a supervisor, `nohup`) does not, and an
/// orphaned OpenCode would keep the port and the session database open. Hence a
/// handler that only sets a flag, which is all a signal handler may safely do.
fn wait_for_shutdown() {
    static STOP: AtomicBool = AtomicBool::new(false);

    #[cfg(unix)]
    {
        extern "C" fn on_signal(_: i32) {
            STOP.store(true, Ordering::Relaxed);
        }
        // SAFETY: the handler touches nothing but an atomic, which is
        // async-signal-safe. Installing it is the documented use of signal(2).
        unsafe {
            libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
            libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        }
    }

    while !STOP.load(Ordering::Relaxed) {
        std::thread::sleep(Duration::from_millis(200));
        // On Windows a console Ctrl-C terminates this process outright; the
        // sidecar is attached to the same console and receives it too.
        #[cfg(not(unix))]
        {
            continue;
        }
    }
}

/// The LAN IP this machine would use to reach the internet — found without
/// sending a packet (a UDP connect just picks the route).
fn local_ip() -> Option<String> {
    let s = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("8.8.8.8:80").ok()?;
    s.local_addr().ok().map(|a| a.ip().to_string())
}

