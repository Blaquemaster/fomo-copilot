/** True only when the update's chat id is the configured private admin chat. */
export function isAllowlistedAdmin(
  chatId: number | string | undefined,
  adminChatId: string,
): boolean {
  if (chatId === undefined) return false;
  const expected = adminChatId.trim();
  if (!/^[1-9]\d*$/.test(expected)) return false;
  return String(chatId) === expected;
}
