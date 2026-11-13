import { describe, expect, it, vi } from "vitest";

import { handleTelegramMessage } from "./commands.js";

const adminChatId = "424242";

describe("handleTelegramMessage", () => {
  it("does not reply to a chat that is not on the allow list", async () => {
    const reply = vi.fn(async () => undefined);
    const crash = vi.fn(async () => undefined);
    const result = await handleTelegramMessage({
      chatId: 999,
      text: "/ping",
      adminChatId,
      reply,
      crash,
    });
    expect(result).toEqual({ action: "ignore", reason: "not-allowlisted" });
    expect(reply).not.toHaveBeenCalled();
    expect(crash).not.toHaveBeenCalled();
  });

  it("answers /ping for the admin chat only", async () => {
    const reply = vi.fn(async () => undefined);
    const crash = vi.fn(async () => undefined);
    const result = await handleTelegramMessage({
      chatId: 424242,
      text: "/ping@FomoCopilotBot",
      adminChatId,
      reply,
      crash,
    });
    expect(result).toEqual({ action: "reply" });
    expect(reply).toHaveBeenCalledWith("pong");
    expect(crash).not.toHaveBeenCalled();
  });

  it("acknowledges /crashtest and then requests a crash", async () => {
    const order: string[] = [];
    const result = await handleTelegramMessage({
      chatId: "424242",
      text: "/crashtest",
      adminChatId,
      reply: async () => {
        order.push("reply");
      },
      crash: async (error) => {
        order.push(error.message);
      },
    });
    expect(result.action).toBe("crash");
    expect(order[0]).toBe("reply");
    expect(order[1]).toContain("/crashtest");
  });

  it("does not crash when a non-admin sends /crashtest", async () => {
    const crash = vi.fn(async () => undefined);
    const result = await handleTelegramMessage({
      chatId: 7,
      text: "/crashtest",
      adminChatId,
      reply: async () => undefined,
      crash,
    });
    expect(result.action).toBe("ignore");
    expect(crash).not.toHaveBeenCalled();
  });
});
