#!/usr/bin/env -S npx tsx
// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Slack -> NemoClaw bridge (Socket Mode).
 *
 * Messages from Slack are forwarded to the OpenClaw agent running
 * inside the sandbox. Responses are posted back to Slack.
 *
 * Env:
 *   SLACK_BOT_TOKEN        Bot token (xoxb-...)
 *   SLACK_APP_TOKEN        App token (xapp-...) for Socket Mode
 *   SANDBOX_NAME           Sandbox name (default: nemoclaw)
 *   SLACK_ALLOWED_CHANNELS Comma-separated channel IDs to accept (optional)
 *   SLACK_ALLOWED_USERS    Comma-separated Slack user IDs to accept (optional)
 *   SLACK_REQUIRE_MENTION  Set to 1 (default) to require @mention, 0 to disable
 *   SLACK_PASS_API_KEY     Set to 1 to pass NVIDIA_API_KEY into the sandbox
 *   NVIDIA_API_KEY         Optional for NVIDIA-hosted inference (only used if pass enabled)
 */

import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import type { WebClient } from "@slack/web-api";
import { App } from "@slack/bolt";
import { parseAllowlist, decideSlackMessage } from "../src/lib/slack-bridge";

const require = createRequire(import.meta.url);
const { resolveOpenshell } = require("../bin/lib/resolve-openshell") as {
  resolveOpenshell: () => string | null;
};
const { shellQuote, validateName } = require("../bin/lib/runner") as {
  shellQuote: (value: string) => string;
  validateName: (name: string, label?: string) => string;
};

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("NemoClaw Slack Bridge (Socket Mode)");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx scripts/slack-bridge.ts");
  console.log("");
  console.log("Required env:");
  console.log("  SLACK_BOT_TOKEN   Bot token (xoxb-...)");
  console.log("  SLACK_APP_TOKEN   App token (xapp-...)");
  console.log("");
  console.log("Optional env:");
  console.log("  SANDBOX_NAME           Sandbox name (default: nemoclaw)");
  console.log("  SLACK_ALLOWED_CHANNELS Comma-separated channel IDs to accept");
  console.log("  SLACK_ALLOWED_USERS    Comma-separated Slack user IDs to accept");
  console.log("  SLACK_REQUIRE_MENTION  Set to 1 (default) to require @mention, 0 to disable");
  console.log("  SLACK_PASS_API_KEY     Set to 1 to pass NVIDIA_API_KEY into sandbox");
  console.log("  NVIDIA_API_KEY         For NVIDIA-hosted inference (pass only if enabled)");
  process.exit(0);
}

const OPENSHELL = resolveOpenshell();
if (!OPENSHELL) {
  console.error("openshell not found on PATH or in common locations");
  process.exit(1);
}

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const APP_TOKEN = process.env.SLACK_APP_TOKEN;
const API_KEY = process.env.NVIDIA_API_KEY || "";
const SANDBOX = process.env.SANDBOX_NAME || "nemoclaw";
try {
  validateName(SANDBOX, "SANDBOX_NAME");
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

const ALLOWED_CHANNELS = parseAllowlist(process.env.SLACK_ALLOWED_CHANNELS);
const ALLOWED_USERS = parseAllowlist(process.env.SLACK_ALLOWED_USERS);
const REQUIRE_MENTION = process.env.SLACK_REQUIRE_MENTION !== "0";
const PASS_API_KEY = process.env.SLACK_PASS_API_KEY === "1";

if (!BOT_TOKEN) {
  console.error("SLACK_BOT_TOKEN required (xoxb-...)");
  process.exit(1);
}
if (!APP_TOKEN) {
  console.error("SLACK_APP_TOKEN required (xapp-...) for Socket Mode");
  process.exit(1);
}

const COOLDOWN_MS = 5000;
const lastMessageTime = new Map<string, number>();
const busyChannels = new Set<string>();

// Slack limits are around 4000 chars; keep a bit of headroom.
function chunkSlackText(text: string, limit = 3900) {
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks;
}

// ── Run agent inside sandbox ──────────────────────────────────────

function runAgentInSandbox(message: string, sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const sshConfig = execFileSync(OPENSHELL, ["sandbox", "ssh-config", SANDBOX], {
      encoding: "utf-8",
    });

    const fs = require("node:fs") as typeof import("node:fs");
    const confDir = fs.mkdtempSync("/tmp/nemoclaw-slack-ssh-");
    const confPath = `${confDir}/config`;
    fs.writeFileSync(confPath, sshConfig, { mode: 0o600 });

    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9-]/g, "");
    const apiExport = PASS_API_KEY && API_KEY ? `export NVIDIA_API_KEY=${shellQuote(API_KEY)} && ` : "";
    const cmd =
      apiExport +
      `nemoclaw-start openclaw agent --agent main --local -m ${shellQuote(message)} --session-id ${shellQuote(
        "slack-" + safeSessionId,
      )}`;

    const proc = spawn("ssh", ["-T", "-F", confPath, `openshell-${SANDBOX}`, cmd], {
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      try {
        fs.unlinkSync(confPath);
        fs.rmdirSync(confDir);
      } catch {
        // ignore cleanup errors
      }

      const lines = stdout.split("\n");
      const responseLines = lines.filter(
        (l) =>
          !l.startsWith("Setting up NemoClaw") &&
          !l.startsWith("[plugins]") &&
          !l.startsWith("(node:") &&
          !l.includes("NemoClaw ready") &&
          !l.includes("NemoClaw registered") &&
          !l.includes("openclaw agent") &&
          l.trim() !== "",
      );

      const response = responseLines.join("\n").trim();

      if (response) {
        resolve(response);
      } else if (code !== 0) {
        resolve(`Agent exited with code ${code}. ${stderr.trim().slice(0, 500)}`);
      } else {
        resolve("(no response)");
      }
    });

    proc.on("error", (err) => {
      resolve(`Error: ${(err as Error).message}`);
    });
  });
}

// ── Slack app ─────────────────────────────────────────────────────

const app = new App({
  token: BOT_TOKEN,
  appToken: APP_TOKEN,
  socketMode: true,
});

let BOT_USER_ID: string | null = null;

app.message(async ({ message, client, context }) => {
  const channel = (message as { channel: string }).channel;
  const user = (message as { user?: string }).user;
  const text = (message as { text?: string }).text || "";
  const botId = BOT_USER_ID || (context as { botUserId?: string }).botUserId;
  const decision = decideSlackMessage(
    {
      channel,
      user,
      text,
      isBot: Boolean((message as { bot_id?: string }).bot_id),
    },
    {
      allowedChannels: ALLOWED_CHANNELS,
      allowedUsers: ALLOWED_USERS,
      requireMention: REQUIRE_MENTION,
      botUserId: botId || null,
    },
  );
  if (decision !== "allow") {
    if (decision === "channel") {
      console.log(`[ignored] channel ${channel} not in allowed list`);
    } else if (decision === "user") {
      console.log(`[ignored] user ${user || "unknown"} not in allowed list`);
    }
    return;
  }

  const now = Date.now();
  const lastTime = lastMessageTime.get(channel) || 0;
  if (now - lastTime < COOLDOWN_MS) return;
  if (busyChannels.has(channel)) return;

  lastMessageTime.set(channel, now);
  busyChannels.add(channel);

  const ts = (message as { ts?: string }).ts || "";
  const sessionId = `${channel}-${user || "unknown"}-${ts}`;
  try {
    const response = await runAgentInSandbox(text, sessionId);
    const chunks = chunkSlackText(response || "(no response)");
    const threadTs = (message as { thread_ts?: string }).thread_ts || ts;
    for (const chunk of chunks) {
      await (client as WebClient).chat.postMessage({ channel, text: chunk, thread_ts: threadTs });
    }
  } catch (err) {
    const threadTs = (message as { thread_ts?: string }).thread_ts || ts;
    await (client as WebClient).chat.postMessage({
      channel,
      text: `Error: ${(err as Error).message || err}`,
      thread_ts: threadTs,
    });
  } finally {
    busyChannels.delete(channel);
  }
});

async function main(): Promise<void> {
  const auth = await app.client.auth.test();
  if (auth && auth.ok && auth.user_id) {
    BOT_USER_ID = auth.user_id;
  }
  await app.start();
  console.log("");
  console.log("  +-----------------------------------------------------+");
  console.log("  |  NemoClaw Slack Bridge                              |");
  console.log("  |                                                     |");
  console.log("  |  Socket Mode: enabled                               |");
  console.log("  |  Sandbox: " + (SANDBOX + "                              ").slice(0, 40) + "|");
  if (REQUIRE_MENTION) {
    console.log("  |  Require mention: yes                               |");
  } else {
    console.log("  |  Require mention: no                                |");
  }
  if (!ALLOWED_CHANNELS && !ALLOWED_USERS && !REQUIRE_MENTION) {
    console.log("  |  WARNING: no allowlist and no mention requirement   |");
  }
  console.log("  |                                                     |");
  console.log("  |  Messages are forwarded to the OpenClaw agent      |");
  console.log("  |  inside the sandbox. Run 'openshell term' in       |");
  console.log("  |  another terminal to monitor + approve egress.     |");
  console.log("  +-----------------------------------------------------+");
  console.log("");
}

main().catch((err) => {
  console.error("Failed to start Slack bridge:", (err as Error).message || err);
  process.exit(1);
});
