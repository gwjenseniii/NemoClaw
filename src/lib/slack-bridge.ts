// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

export type SlackDecision =
  | "allow"
  | "no_text"
  | "bot"
  | "channel"
  | "user"
  | "mention";

export type SlackAllowlist = Set<string> | null;

export interface SlackMessageInput {
  channel?: string | null;
  user?: string | null;
  text?: string | null;
  isBot?: boolean;
}

export interface SlackDecisionOptions {
  allowedChannels: SlackAllowlist;
  allowedUsers: SlackAllowlist;
  requireMention: boolean;
  botUserId?: string | null;
}

export function parseAllowlist(value?: string): SlackAllowlist {
  if (!value) return null;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

export function decideSlackMessage(
  input: SlackMessageInput,
  options: SlackDecisionOptions,
): SlackDecision {
  if (input.isBot) return "bot";
  if (!input.text) return "no_text";
  if (options.allowedChannels && (!input.channel || !options.allowedChannels.has(input.channel))) {
    return "channel";
  }
  if (options.allowedUsers && (!input.user || !options.allowedUsers.has(input.user))) {
    return "user";
  }
  if (options.requireMention) {
    const botId = options.botUserId;
    if (!botId || !input.text.includes(`<@${botId}>`)) {
      return "mention";
    }
  }
  return "allow";
}
