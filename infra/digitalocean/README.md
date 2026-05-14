# DigitalOcean dev box

A personal "remote MacBook" — a DigitalOcean droplet running Claude Code
with unrestricted outbound network. Used to perform operations that the
hosted Claude Code on the web sandbox cannot, like wiring Stytch
credentials into a Vercel project (the Stytch and Vercel APIs are blocked
from the sandbox).

You SSH in from your laptop, attach to a tmux session, and run Claude Code
on the droplet exactly as if it were local — except the droplet's network
egress is wide open.

## What's on the box

`cloud-init.yaml` provisions:

- Ubuntu 24.04 LTS, fully updated
- Node 20 (NodeSource)
- `@anthropic-ai/claude-code` and `vercel` CLIs, installed globally
- `doctl` (DigitalOcean CLI) at `/usr/local/bin/doctl`
- `tmux`, `git`, `jq`, `curl`
- A non-root user `tinker` with passwordless `sudo` and your droplet SSH key
- `ufw` configured to allow only inbound SSH
- `unattended-upgrades` for automatic security patches

No secrets are baked in. All auth (Claude, Vercel, doctl) happens on first
SSH.

## One-time provisioning

### Prereqs

- A DigitalOcean account with an SSH public key uploaded
  (Settings → Security → SSH Keys).
- `doctl` installed locally and authenticated (`doctl auth init`) — or
  use the web console instead.

### Option A — `doctl` from your laptop

```bash
doctl compute droplet create tinker-dev \
  --region nyc3 \
  --size s-2vcpu-4gb \
  --image ubuntu-24-04-x64 \
  --ssh-keys "$(doctl compute ssh-key list --format ID --no-header | head -n1)" \
  --user-data-file infra/digitalocean/cloud-init.yaml \
  --wait
```

The `--ssh-keys` snippet picks the first key on your DO account; replace
it with a specific key ID if you have several.

### Option B — DO web console

1. Create Droplet → Ubuntu 24.04 → Basic / Regular / 2 GB RAM (or larger).
2. Authentication: pick your SSH key.
3. "Advanced options" → "Add Initial Scripts (user data)" → paste the
   contents of `cloud-init.yaml`.
4. Create.

Cloud-init takes ~2 minutes after the droplet shows green. Watch progress
with `ssh tinker@<ip> 'sudo cloud-init status --wait'`.

## First SSH

```bash
ssh tinker@<droplet-ip>
```

You land in a normal shell as the `tinker` user. The motd points you back
to this README.

## First-time auth

Run each of these once. They open device-code flows that you complete in
your laptop's browser; nothing is stored in the repo.

```bash
claude login        # Claude Code auth
vercel login        # Vercel CLI auth
doctl auth init     # DigitalOcean CLI (optional — for managing this box)
```

## Daily use

```bash
ssh tinker@<droplet-ip>
tmux new -As work          # attach to (or create) a persistent session
git clone https://github.com/beginner-work/web.git
cd web
claude                      # start Claude Code
```

Detach from tmux with `Ctrl-b d`. The session keeps running after you
disconnect; reattach next time with `tmux attach -t work`.

## Syncing Stytch credentials into Vercel

This is the operation that's blocked from the hosted sandbox. On the
droplet:

```bash
cd /path/to/your/vercel-linked/repo
vercel link                                # one-time, picks the Vercel project

# Put your Stytch creds in a local file (NOT committed). Example:
cat > /tmp/stytch.env <<'EOF'
STYTCH_PROJECT_ID=project-test-...
STYTCH_SECRET=secret-test-...
STYTCH_PUBLIC_TOKEN=public-token-test-...
EOF

# Push them as Vercel env vars (default scope: production).
~/web/infra/digitalocean/sync-stytch-to-vercel.sh /tmp/stytch.env production

# Clean up.
shred -u /tmp/stytch.env
```

The script:

- Parses `KEY=VALUE` lines (comments and blanks ignored, quotes stripped).
- Shows you the list of variables it's about to write and asks for
  confirmation.
- Removes any existing value in the target scope before re-adding, since
  `vercel env add` won't overwrite.
- Pipes values via stdin so they never appear in `ps` or shell history.

Verify with `vercel env ls production` and trigger a redeploy
(`vercel --prod`) to pick up the new values.

## Keeping the box healthy

- **Stop when idle:** `doctl compute droplet-action power-off tinker-dev`
  pauses billing for compute (you still pay for storage). Power back on
  with `power-on`.
- **Resize:** `doctl compute droplet-action resize tinker-dev --size s-4vcpu-8gb`.
- **Destroy:** `doctl compute droplet delete tinker-dev`. Cloud-init is
  idempotent — rerunning the create command brings back an identical box.
- **Updates:** unattended-upgrades runs nightly. For a manual sweep:
  `sudo apt update && sudo apt upgrade -y && sudo reboot`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ssh` hangs on connect | Cloud-init still running; wait 1-2 min after green status. |
| `claude: command not found` | Open a new shell, or `source /etc/profile.d/tinker-paths.sh`. |
| `vercel env add` fails with "Project not found" | `vercel link` in the current dir first. |
| Need a port open (e.g. `vercel dev` on `:3000`) | `sudo ufw allow 3000/tcp`; close after with `ufw delete allow 3000/tcp`. |
| `cloud-init status` shows `error` | `sudo less /var/log/cloud-init-output.log`. |
