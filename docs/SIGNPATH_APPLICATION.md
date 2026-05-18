# SignPath Foundation — application draft

Paste these answers into the form at https://signpath.org/apply.

You're applying as an OSS maintainer for a free Windows desktop app. SignPath Foundation signs OSS releases at no cost; in exchange they review your project to confirm it's a legitimate open-source effort (real human, public source, sane license, no malware-shaped behavior).

---

## Project details

**Project name**
Log Viewer

**Project URL (source)**
https://github.com/Abhi-AlgoForge/log-viewer

**Releases / downloads URL**
https://github.com/Abhi-AlgoForge/log-viewer/releases

**License**
MIT (see `LICENSE` in the repo)

**Project description (1–3 sentences)**
A local-first desktop log viewer for Windows / macOS / Linux, built with Tauri 2 (Rust) and SolidJS. Handles multi-GB files via memory-mapped reads, clusters near-identical lines into templates, and ships an opt-in AI layer for natural-language filtering and error explanation. All processing is local; AI features require the user to supply their own API key.

**What you want to sign**
Windows installers (NSIS `.exe` and MSI) produced by `npm run tauri build`, plus the bundled `log-viewer.exe` inside them. Both are unsigned today and trigger Microsoft Defender SmartScreen warnings on first download.

**Build environment**
GitHub Actions, `windows-latest` runner. Workflow already lives at `.github/workflows/release.yml`. Triggers only on `v*.*.*` tag pushes.

**How users obtain your software**
Public GitHub Releases on the URL above. No paywall, no telemetry, no auto-update of signed binaries (manual download for now).

---

## Maintainer / contact

**Name**
*(your real name)*

**Email**
gpugyo@protonmail.com

**Country**
*(your country — used only for KYC, not displayed)*

**GitHub username**
Abhi-AlgoForge

**Public profile that proves you're a real person**
*(link to your GitHub profile, LinkedIn, or personal website — they want one piece of evidence that the maintainer is a human, not a bot account)*

---

## Why you need code signing

Without signing, the Windows installer triggers Microsoft Defender SmartScreen on every download:

> Windows protected your PC. Microsoft Defender SmartScreen prevented an unrecognised app from starting.

This wall is a hard conversion-killer for a free OSS dev tool — most users abandon the install instead of clicking "More info → Run anyway". Code signing removes the warning and lets the bundled file association ("Open .log with Log Viewer") actually work without scaring users.

I'm a solo OSS developer and cannot justify the $200–600/yr cost of a commercial OV/EV certificate for a free project. SignPath Foundation is the obvious fit.

---

## Anything else they ask

If the form asks for **CI setup status**: the GitHub Actions workflow is already written and committed (`.github/workflows/release.yml`); it only needs the secrets and the SignPath GitHub App installed on the repo to start signing.

If the form asks **how many releases per year**: estimate 4–12 (no firm cadence; just whenever there's user-visible improvement).

If the form asks about **downstream redistribution**: none planned. Users install directly from GitHub Releases.
