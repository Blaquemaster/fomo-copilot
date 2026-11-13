import { describe, expect, it } from "vitest";

import { sendTelegramMessage } from "./sendMessage.js";

describe("sendTelegramMessage", () => {
  it("posts plain text to sendMessage and does not put the token in thrown errors", async () => {
    const token = "test-token-value";
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body)),
      });
      return new Response(JSON.stringify({ ok: false, description: `leaked ${token}` }), {
        status: 401,
      });
    };

    await expect(
      sendTelegramMessage({
        token,
        chatId: "424242",
        text: "hello",
        fetchImpl,
      }),
    ).rejects.toThrow("telegram sendMessage failed with HTTP 401");

    try {
      await sendTelegramMessage({ token, chatId: "424242", text: "hello", fetchImpl });
    } catch (error) {
      expect((error as Error).message).not.toContain(token);
      expect((error as Error).message).not.toContain("leaked");
    }

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe(`https://api.telegram.org/bot${token}/sendMessage`);
    expect(calls[0]?.body).toEqual({
      chat_id: "424242",
      text: "hello",
      disable_web_page_preview: true,
    });
  });

  it("replaces transport failures with a token-free error", async () => {
    const token = "test-token-value";
    const fetchImpl: typeof fetch = async () => {
      throw new Error(`connect ECONNREFUSED https://api.telegram.org/bot${token}/sendMessage`);
    };
    await expect(
      sendTelegramMessage({ token, chatId: "424242", text: "hello", fetchImpl }),
    ).rejects.toThrow("telegram sendMessage request failed");
  });
});
