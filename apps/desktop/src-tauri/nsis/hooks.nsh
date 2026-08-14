; NSIS installer hooks, wired up via bundle > windows > nsis > installerHooks.
;
; Why this exists: the app ships sidecars (opencode, uv, agent-browser) that run
; from $INSTDIR but are not ${MAINBINARYNAME}, so the bundler's own
; CheckIfAppIsRunning macro never sees them. A survivor holds a file handle on
; $INSTDIR, the uninstaller's Delete/RMDir fail silently, and the *next*
; installer's reinstall page aborts with "Unable to uninstall!" -- its success
; test is `$0 <> 0 ${OrIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"`, which
; a leftover binary trips even when the uninstaller exited 0. See issue #113.
;
; Only processes this user owns are touched (installMode is currentUser), and a
; sidecar that is already gone is not an error. msedgewebview2.exe is
; deliberately left alone -- it is shared with every other WebView2 app.

!macro KillSidecarProcess name
  nsis_tauri_utils::FindProcessCurrentUser "${name}"
  Pop $0
  ${If} $0 = 0
    nsis_tauri_utils::KillProcessCurrentUser "${name}"
    Pop $0
    Sleep 500
  ${EndIf}
!macroend

; Runs at the top of Section Uninstall, before the main binary is deleted.
!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KillSidecarProcess "opencode.exe"
  !insertmacro KillSidecarProcess "agent-browser.exe"
  !insertmacro KillSidecarProcess "uv.exe"
!macroend
