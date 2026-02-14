# Steam CI Notes

## Required GitHub Secrets

Set these in repository settings:

- `STEAM_USERNAME`: Steam partner build account name
- `STEAM_PASSWORD`: Steam partner build account password

If your account requires Steam Guard every run, pass the code to workflow input `steam_guard_code` when running `steam-upload`.

## Build workflow

- Workflow: `build-desktop`
- Trigger: manual (`workflow_dispatch`) or tag push (`v*`)
- Outputs:
  - installer bundles for each OS (`bundle-*` artifacts)
  - Steam upload contents for each OS (`steam-content-*` artifacts)

## Steam upload workflow

- Workflow: `steam-upload` (manual only)
- Inputs:
  - `app_id`
  - `depot_windows`
  - `depot_macos`
  - `depot_linux`
  - `branch`
  - `desc`
  - optional `steam_guard_code`

This workflow builds all three platforms, generates temporary SteamPipe VDF files, and uploads with SteamCMD.

## Recommended Depot layout

- Windows depot: upload `steam-content/windows` (`app.exe`)
- macOS depot: upload `steam-content/macos` (`steamimageexporter.app`)
- Linux depot: upload `steam-content/linux` (`app`)

If you later rename the Rust package from `app` to your final game name, update workflow copy paths accordingly.
