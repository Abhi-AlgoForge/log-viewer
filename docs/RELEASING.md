# Releasing Log Viewer

End-to-end release flow: bump versions, push a tag, let CI build + sign + publish.

Day-to-day you'll only do steps **1** and **2**. Steps 3-6 happened once during initial setup.

---

## 1. Bump versions

Three files carry the version string and they must agree:

- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `"version"`

Commit as `chore: bump version to vX.Y.Z`.

## 2. Tag + push

```powershell
git tag vX.Y.Z
git push --tags
```

That triggers `.github/workflows/release.yml`, which:

1. Builds the NSIS `.exe` and MSI on a `windows-latest` runner
2. Uploads them as an unsigned artifact
3. Submits the artifact to **SignPath** for code signing (foundation tier, free for OSS)
4. Downloads the signed binaries
5. Creates a GitHub Release tagged `vX.Y.Z` with auto-generated release notes and the signed installers attached

A signed release takes ~10 minutes to appear at https://github.com/Abhi-AlgoForge/log-viewer/releases.

---

# One-time setup

You shouldn't need to redo any of this — it's documented so you know what the moving parts are and where to look when something breaks.

## 3. SignPath Foundation onboarding

1. Apply at https://signpath.org/apply. The text to paste is in [`docs/SIGNPATH_APPLICATION.md`](./SIGNPATH_APPLICATION.md).
2. Wait for approval (typically 1–2 weeks; they're a small team and review every applicant by hand).
3. Once approved, install the **SignPath GitHub App** on the repo: https://github.com/apps/signpath-io
4. In the SignPath portal, create:
   - A project (slug: `log-viewer`)
   - A signing policy named `release-signing` configured to recurse into the installer and sign nested `.exe` / `.msi` files
   - A user API token (rotate it yearly; expires by default)

## 4. GitHub secrets

Add these in repo Settings → Secrets and variables → Actions:

| Secret | Where to find it |
|---|---|
| `SIGNPATH_API_TOKEN` | SignPath portal → your user → API tokens → "Generate" |
| `SIGNPATH_ORGANIZATION_ID` | SignPath portal → org settings, top-right UUID |
| `SIGNPATH_PROJECT_SLUG` | The project slug you chose (`log-viewer`) |
| `SIGNPATH_SIGNING_POLICY_SLUG` | `release-signing` (or whatever you named it) |

## 5. (Optional) Updater keypair

Only needed if you want the in-app "Check for updates" button to find new releases:

```powershell
npm run tauri signer generate -- -w $env:USERPROFILE\.tauri\log-viewer.key
```

Paste the public key into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`, flip `plugins.updater.active` to `true`, and set `bundle.createUpdaterArtifacts` to `true`.

Then for each release, the workflow needs the private key exposed as `TAURI_SIGNING_PRIVATE_KEY` (and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if you set one).

## 6. (Optional) macOS / Linux

The workflow currently builds Windows only. For mac/linux:

1. Add an `ubuntu-latest` / `macos-latest` matrix entry to `release.yml`
2. Linux: install the Tauri system deps before `tauri build` (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`)
3. macOS: signing/notarization needs an Apple Developer account ($99/yr); set `APPLE_*` secrets and add the Tauri notarization plugin. SignPath does not handle macOS signing — that's Apple's exclusive monopoly.

---

## Troubleshooting

**"Signing request failed: project not found"** — verify `SIGNPATH_PROJECT_SLUG` matches the slug shown in the SignPath portal (case-sensitive, no spaces).

**"Artifact validation failed"** — your SignPath signing policy probably forbids the file type you tried to sign. Loosen the artifact configuration in the policy or repack as a `.zip`.

**Release created but no installer attached** — check the `Submit signing request` step in the workflow run; if it succeeded but `Publish GitHub Release` failed, the `signed-installers/` directory was empty. Inspect the SignPath portal for that signing request and re-download manually if needed.
