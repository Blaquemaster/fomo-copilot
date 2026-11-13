import { isAllowlistedAdmin } from "@fomo/core";

export type HandleResult =
  | { action: "ignore"; reason: "not-allowlisted" | "empty" }
  | { action: "reply" }
  | { action: "status" }
  | { action: "events" }
  | { action: "crash" };

const HELP = "Commands: /ping, /status, /events, /crashtest";

export async function handleTelegramMessage(input: {
  chatId: number | string | undefined;
  text: string | undefined;
  adminChatId: string;
  reply: (text: string) => Promise<void>;
  crash: (error: Error) => Promise<void>;
}): Promise<HandleResult> {
  if (!isAllowlistedAdmin(input.chatId, input.adminChatId)) {
    return { action: "ignore", reason: "not-allowlisted" };
  }
  const raw = input.text?.trim() ?? "";
  if (raw.length === 0) {
    return { action: "ignore", reason: "empty" };
  }
  const head = raw.split(/\s+/)[0] ?? "";
  const command = head.split("@")[0] ?? "";
  if (command === "/ping") {
    await input.reply("pong");
    return { action: "reply" };
  }
  if (command === "/status") {
    return { action: "status" };
  }
  if (command === "/events") {
    return { action: "events" };
  }
  if (command === "/crashtest") {
    await input.reply("Crash test triggered. This process will exit after sending an alert.");
    await input.crash(new Error("intentional /crashtest"));
    return { action: "crash" };
  }
  if (command === "/start" || command === "/help") {
    await input.reply(HELP);
    return { action: "reply" };
  }
  await input.reply(`Unknown command. ${HELP}`);
  return { action: "reply" };
}
