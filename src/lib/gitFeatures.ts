// Single switch that disables all user-facing git integration in this fork.
// Backend Tauri commands still exist so vault setup and file-date helpers
// keep working; we only hide the UI surface that lets users drive git from
// inside the app (sync, commit, pull, push, conflicts, history, pulse).
export const GIT_FEATURES_ENABLED = false
