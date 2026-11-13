export interface SendTelegramMessageOptions {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Outbound sendMessage only. Errors omit the response body and the request URL,
 * because the URL contains the bot token.
 */
export async function sendTelegramMessage(options: SendTelegramMessageOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `https://api.telegram.org/bot${options.token}/sendMessage`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: options.chatId,
        text: options.text,
        disable_web_page_preview: true,
      }),
      signal: options.signal,
    });
  } catch {
    throw new Error("telegram sendMessage request failed");
  }
  if (!response.ok) {
    throw new Error(`telegram sendMessage failed with HTTP ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("telegram sendMessage returned invalid JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("ok" in payload) ||
    payload.ok !== true
  ) {
    throw new Error("telegram sendMessage returned ok=false");
  }
}
