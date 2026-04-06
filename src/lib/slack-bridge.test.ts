// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  parseAllowlist,
  decideSlackMessage,
  type SlackDecisionOptions,
} from "../../dist/lib/slack-bridge";

describe("lib/slack-bridge", () => {
  describe("parseAllowlist", () => {
    it("returns null for undefined input", () => {
      expect(parseAllowlist(undefined)).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseAllowlist("")).toBeNull();
    });

    it("returns null for whitespace-only string", () => {
      expect(parseAllowlist("  , , ")).toBeNull();
    });

    it("parses a single item", () => {
      expect(parseAllowlist("C123")).toEqual(new Set(["C123"]));
    });

    it("parses comma-separated items with whitespace", () => {
      expect(parseAllowlist("C1, C2 ,C3")).toEqual(new Set(["C1", "C2", "C3"]));
    });
  });

  describe("decideSlackMessage", () => {
    const base: SlackDecisionOptions = {
      allowedChannels: null,
      allowedUsers: null,
      requireMention: false,
      botUserId: null,
    };

    it("rejects bot messages", () => {
      expect(decideSlackMessage({ text: "hi", isBot: true }, base)).toBe("bot");
    });

    it("rejects messages without text", () => {
      expect(decideSlackMessage({ text: "" }, base)).toBe("no_text");
      expect(decideSlackMessage({}, base)).toBe("no_text");
    });

    it("rejects messages from disallowed channels", () => {
      const options: SlackDecisionOptions = {
        ...base,
        allowedChannels: new Set(["C1"]),
      };
      expect(decideSlackMessage({ channel: "C2", text: "hi" }, options)).toBe("channel");
    });

    it("rejects messages from disallowed users", () => {
      const options: SlackDecisionOptions = {
        ...base,
        allowedUsers: new Set(["U1"]),
      };
      expect(decideSlackMessage({ user: "U2", text: "hi" }, options)).toBe("user");
    });

    it("requires mention when configured", () => {
      const options: SlackDecisionOptions = {
        ...base,
        requireMention: true,
        botUserId: "U999",
      };
      expect(decideSlackMessage({ text: "hello", user: "U1" }, options)).toBe("mention");
      expect(decideSlackMessage({ text: "<@U999> hello" }, options)).toBe("allow");
    });

    it("allows messages that satisfy all constraints", () => {
      const options: SlackDecisionOptions = {
        allowedChannels: new Set(["C1"]),
        allowedUsers: new Set(["U1"]),
        requireMention: false,
        botUserId: "U999",
      };
      expect(decideSlackMessage({ channel: "C1", user: "U1", text: "ok" }, options)).toBe("allow");
    });
  });
});
