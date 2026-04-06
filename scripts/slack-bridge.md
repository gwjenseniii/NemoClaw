# NemoClaw Slack Bridge (Socket Mode)

This bridge forwards Slack messages to the OpenClaw agent running inside a
NemoClaw sandbox, then posts the agent response back to Slack.

## Requirements

- Slack app with Socket Mode enabled
- Bot token: `xoxb-...`
- App token: `xapp-...`
- `openshell` CLI available on the host
- A running sandbox (example: `higgins`)

## Slack App Setup

1. Enable **Socket Mode** and generate an app-level token (`xapp-...`).
2. Add **Bot Token Scopes** (minimum):
   - `chat:write`
   - `channels:history`
   - `groups:history`
   - `im:history`
   - `mpim:history`
3. Subscribe to **Event Subscriptions**:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
4. Install the app to your workspace and invite the bot to the channel.

## Run

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
export SANDBOX_NAME=higgins
npx tsx scripts/slack-bridge.ts
```

## Optional Env

- `SLACK_ALLOWED_CHANNELS` — comma-separated channel IDs to accept
- `SLACK_ALLOWED_USERS` — comma-separated user IDs to accept
- `SLACK_REQUIRE_MENTION` — set to `1` (default) to require @mention, `0` to disable
- `SLACK_PASS_API_KEY` — set to `1` to pass NVIDIA_API_KEY into the sandbox
- `NVIDIA_API_KEY` — required if your inference provider needs it (only used if pass enabled)

## Notes

- Approvals are handled in the OpenShell TUI / Control UI.
- Use `openshell term` in a separate terminal to approve blocked requests.

## Test Plan

1. Start the bridge and send a message in a channel where the bot is invited.
2. Confirm the agent response appears in the same thread.
3. Trigger a blocked egress request and approve it in `openshell term`.
