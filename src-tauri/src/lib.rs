mod ai;
mod cluster;
mod commands;
mod error;
mod filter;
mod histogram;
mod index;
mod merge;
mod parse;
mod persistence;
mod search;
mod source;
mod state;
mod tail;
mod trace;

/// Extract path-like CLI args from a process argv list. Filters out flags and
/// the binary name. Used by both the initial launch and any second-instance
/// invocation funneled through tauri-plugin-single-instance.
fn collect_cli_paths(args: impl IntoIterator<Item = String>) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a).exists())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Emitter;
    let cli_paths: Vec<String> = collect_cli_paths(std::env::args());

    let mut builder = tauri::Builder::default();

    // Single-instance: when the user launches a second log-viewer.exe (e.g.
    // double-clicking a .log file once the file association is registered),
    // the plugin invokes this callback in the running process instead of
    // spinning up a second window. We replay the new argv as a cli-open
    // event so the existing window opens the file.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            let paths = collect_cli_paths(argv);
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("cli-open", paths);
            }
        }));
    }

    builder = builder
        .manage(state::AppState::default())
        .manage(ai::AiState::load())
        .manage(persistence::WorkspaceStore::load())
        .on_window_event(|window, event| {
            // When the main window is closed, take a best-effort pass at
            // cleaning up: kill any child processes spawned by command
            // sources, then wipe our temp directory. We don't try to be
            // surgical about other-instance files — single-instance is the
            // common case and a stale temp file is harmless anyway.
            use tauri::Manager;
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let state = window.state::<state::AppState>();
                for entry in state.sources.iter() {
                    if let Some(mut child) = entry.child_process.lock().take() {
                        let _ = child.kill();
                    }
                }
                let mut temp = std::env::temp_dir();
                temp.push("log-viewer");
                if let Ok(entries) = std::fs::read_dir(&temp) {
                    for e in entries.flatten() {
                        let p = e.path();
                        if p.is_file() {
                            let _ = std::fs::remove_file(&p);
                        }
                    }
                }
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(move |app| {
            if !cli_paths.is_empty() {
                let handle = app.handle().clone();
                let paths = cli_paths.clone();
                std::thread::spawn(move || {
                    // Give the webview a moment to attach the event listener.
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let _ = handle.emit("cli-open", paths);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_version,
            commands::open_file,
            commands::open_command,
            commands::close_source,
            commands::source_info,
            commands::get_lines,
            commands::apply_filter,
            commands::get_filtered_lines,
            commands::clear_filter,
            commands::start_tail,
            commands::stop_tail,
            commands::cluster_source,
            commands::get_patterns,
            commands::start_merge,
            commands::stop_merge,
            commands::merge_status,
            commands::get_merge_lines,
            commands::ai_get_config,
            commands::ai_set_provider_settings,
            commands::ai_set_active_provider,
            commands::storage_info,
            commands::clear_temp_files,
            commands::load_workspace,
            commands::save_source_state,
            commands::save_last_session,
            commands::export_slice,
            commands::start_dir_watch,
            commands::stop_dir_watch,
            commands::list_dir_watches,
            commands::compute_histogram,
            commands::ai_nl_filter,
            commands::ai_explain_line,
            commands::ai_explain_lines,
            commands::ai_summarize_patterns,
            commands::ai_root_cause,
            commands::ai_root_cause_lines,
            commands::ai_regex_from_examples,
            commands::ai_seed_explain,
            commands::ai_seed_root_cause,
            commands::ai_seed_summarize_patterns,
            commands::ai_chat,
            commands::discover_fields,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
