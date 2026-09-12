# Self-hosting Flow on a Windows PC (home network only)

One-time setup on the Windows machine. After this, every push to `main`
auto-deploys via GitHub Actions (see `.github/workflows/deploy-selfhost.yml`)
— nothing further to run by hand.

Everything below runs in an **elevated PowerShell** (Run as Administrator)
unless noted otherwise.

## 1. Install prerequisites

- **Node.js 20 LTS or newer**: https://nodejs.org — installer defaults are fine.
- **Git for Windows**: https://git-scm.com/download/win

Verify in a new terminal:
```powershell
node -v
git --version
```

## 2. Clone the repo and configure secrets

```powershell
git clone https://github.com/alluke96/flow.git C:\flow
cd C:\flow
```

Secrets (the Drive service account key, etc.) must **never** be committed —
they live in `.env.local`, which is gitignored. Since every deploy checks the
repo out fresh, keep a permanent copy *outside* the repo folder and the
deploy workflow copies it in on every run:

```powershell
New-Item -ItemType Directory -Path C:\flow-secrets -Force
notepad C:\flow-secrets\.env.local
```

Fill it with the same three variables from `.env.example`:
```
GOOGLE_SERVICE_ACCOUNT_KEY=<the same JSON/base64 value you used on Vercel>
GOOGLE_DRIVE_ROOT_FOLDER_ID=<the same folder ID you used on Vercel>
NEXT_PUBLIC_SITE_ORIGIN=http://<this-PC's-LAN-IP>:3000
```
Find the LAN IP with `ipconfig` (the `IPv4 Address` under your wifi/ethernet
adapter, e.g. `192.168.1.42`). This must be the PC's IP, not the TV's.

Copy it into the repo once and do a sanity-check build:
```powershell
Copy-Item C:\flow-secrets\.env.local .env.local
npm ci
npm run build
npm run start
```
Open `http://localhost:3000` in a browser on the same PC to confirm it loads
with your real catalog (not the mock one). Ctrl+C to stop once confirmed.

## 3. Open the port to your LAN (so the TV can reach it)

```powershell
New-NetFirewallRule -DisplayName "Flow (Next.js)" -Direction Inbound `
  -LocalPort 3000 -Protocol TCP -Action Allow -Profile Private
```
`-Profile Private` scopes this to your home network only — it won't accept
connections from outside your LAN.

## 4. Install NSSM and register Flow as a Windows service

NSSM keeps the app running in the background, restarts it if it crashes, and
starts it automatically on boot — without needing a logged-in user session.

Download from https://nssm.cc/download, extract, and use the `win64\nssm.exe`
build. Then, from the extracted folder:

```powershell
.\nssm.exe install Flow "C:\Program Files\nodejs\node.exe" "node_modules\next\dist\bin\next start"
.\nssm.exe set Flow AppDirectory "C:\flow"
.\nssm.exe set Flow AppStdout "C:\flow-secrets\flow.log"
.\nssm.exe set Flow AppStderr "C:\flow-secrets\flow.log"
.\nssm.exe start Flow
```
Confirm it's running: `Get-Service Flow` should show `Running`. Visit
`http://<this-PC's-LAN-IP>:3000` from another device on the same wifi (your
phone, or the TV's browser) to confirm it's reachable over the network, not
just `localhost`.

**Important — revisit this step after step 5.** Once the GitHub Actions
runner is registered, deploys check the repo out into *its own* work folder,
not `C:\flow` — you'll re-point `AppDirectory` there. Steps 2–4 just get you
a known-working manual baseline first.

## 5. Register the GitHub Actions self-hosted runner

Go to https://github.com/alluke96/flow/settings/actions/runners/new,
choose **Windows**, and follow the exact commands GitHub shows there (they
include a short-lived registration token unique to that page load — copy
them directly from GitHub rather than from here, since a token I could type
here would already be expired).

When prompted during `config.cmd`:
- Work folder: press enter for the default, or set `C:\flow-work` for a
  short, predictable path.
- When it asks whether to run as a service: **yes** — this installs the
  runner itself as a Windows service, so it's always listening for jobs,
  same reasoning as step 4.

After it's installed, trigger one deploy (push anything to `main`, or go to
the repo's **Actions** tab → "Deploy to self-hosted Windows" → **Run
workflow**) and watch it in the Actions tab. The job log's first few lines
show the exact checkout path, e.g. `C:\flow-work\_work\flow\flow` — copy
that exact path.

## 6. Point the service at the real checkout path

Using the path from step 5's job log:
```powershell
cd <path to nssm>\win64
.\nssm.exe stop Flow
.\nssm.exe set Flow AppDirectory "<the exact path from the Actions log>"
.\nssm.exe start Flow
```

From now on: push to `main` → Actions runs on your PC → builds → restarts
the `Flow` service with the new code, automatically. `C:\flow` (from step 2)
was only ever a manual bootstrap copy and can be deleted once this is
confirmed working end to end.

## Troubleshooting

- **Service won't start / port already in use**: `Get-Process -Id (Get-NetTCPConnection -LocalPort 3000).OwningProcess` to find what's on port 3000.
- **Runner shows offline in GitHub**: `Get-Service actions.runner.*` — restart it, or re-run `config.cmd` if it was never installed as a service.
- **Deploy runs but site doesn't change**: confirm `AppDirectory` (step 6) actually matches where the runner checks the repo out — a stale `C:\flow` copy still running is the most common cause.
