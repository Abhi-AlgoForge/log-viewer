# Releasing Log Viewer

End-to-end release flow for cutting a new version: bump versions, build signed installers, generate updater manifests, publish to GitHub Releases.

## 1. Bump versions

Three files carry the version string and they must agree:

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `"version"`

Commit as `chore: bump version to vX.Y.Z`.

## 2. Generate a release keypair (first release only)

```bash
npm run tauri signer generate -- -w ~/.tauri/log-viewer.key
```

That writes a private key (`log-viewer.key`) and a public key (`log-viewer.key.pub`). Treat the private key like a credential — never commit it.

Paste the **public key** into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, flip `plugins.updater.active` to `true`, and set `bundle.createUpdaterArtifacts` to `true`. The pubkey is baked into the installer at build time so the updater can verify signatures.

## 3. Configure Windows code signing (optional but recommended)

If you have a code-signing certificate installed in the Windows cert store, add its SHA1 thumbprint to `src-tauri/tauri.conf.json`:

```json
"bundle": {
  "windows": {
    "certificateThumbprint": "YOUR_THUMBPRINT_HEX"
  }
}
```

Without this, installers still build but show SmartScreen warnings on first download.

## 4. Build installers

```bash
# Sets the signing key for updater manifest signing
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content ~/.tauri/log-viewer.key -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password if you set one>"

npm run tauri build
```

Bundles end up under `src-tauri/target/release/bundle/`:
- `msi/Log Viewer_X.Y.Z_x64_en-US.msi` (+ `.sig`)
- `nsis/Log Viewer_X.Y.Z_x64-setup.exe` (+ `.sig`)
- (on macOS) `dmg/Log Viewer_X.Y.Z_aarch64.dmg`
- (on Linux) `appimage/...`, `deb/...`

## 5. Build the updater manifest

The updater plugin expects a JSON file at the endpoint URL. Format:

```json
{
  "version": "X.Y.Z",
  "notes": "What changed in this release",
  "pub_date": "2026-05-18T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contents of .sig>",
      "url": "https://github.com/Abhi-AlgoForge/log-viewer/releases/download/vX.Y.Z/Log.Viewer_X.Y.Z_x64-setup.exe"
    },
    "darwin-aarch64": { "signature": "...", "url": "..." },
    "linux-x86_64":   { "signature": "...", "url": "..." }
  }
}
```

Save as `latest.json` and upload it to the same release.

## 6. Cut the GitHub release

- Tag: `vX.Y.Z`
- Upload: every bundle from step 4 plus `latest.json` from step 5.
- Publish.

Existing users will see the update on next "Check for updates" click (Settings → About).
