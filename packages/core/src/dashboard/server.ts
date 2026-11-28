import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";

import { dashboardView, type DashboardRequest } from "./view.js";

export interface DashboardServer {
  url: string;
  close: () => Promise<void>;
}

/** Listens only when called. The process entrypoint stays stopped unless its flag is true. */
export function dashboardShouldListen(flag: string | undefined): boolean {
  return flag === "true";
}

export async function startDashboardServer(input: {
  token: string;
  host?: string;
  port?: number;
  load: (authorization: string | undefined) => Promise<DashboardRequest>;
}): Promise<DashboardServer> {
  const sessions = new Set<string>();
  const server = createServer(async (request, response) => {
    try {
      await handle(request, response, input.token, sessions, input.load);
    } catch {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "unavailable" }));
    }
  });
  await new Promise<void>((resolve) => {
    server.listen(input.port ?? 0, input.host ?? "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = address && typeof address === "object" ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  sessions: Set<string>,
  load: (authorization: string | undefined) => Promise<DashboardRequest>,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "POST" && url.pathname === "/session") {
    const body = await readBody(request);
    const supplied = readToken(body);
    if (!token || supplied !== token) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    const session = randomBytes(24).toString("base64url");
    sessions.add(session);
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": `fomo_session=${session}; HttpOnly; SameSite=Strict; Path=/`,
    });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(page());
    return;
  }
  const header = request.headers.authorization;
  const cookie = cookieValue(request.headers.cookie, "fomo_session");
  const authorized =
    (typeof header === "string" && header === `Bearer ${token}`) ||
    (cookie !== null && sessions.has(cookie));
  if (!authorized) {
    json(response, 401, { error: "unauthorized" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/view") {
    const view = dashboardView(await load(typeof header === "string" ? header : `Bearer ${token}`));
    json(response, view.status, view.body);
    return;
  }
  json(response, 404, { error: "not_found" });
}

function page(): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>FOMO owner</title></head>
<body>
<main>
<h1>Owner view</h1>
<p>Trading stays off. This page has no control that starts it.</p>
<form id="login">
<label>Token <input name="token" type="password" autocomplete="current-password"></label>
<button type="submit">Open</button>
</form>
<pre id="view">empty</pre>
</main>
<script>
document.getElementById("login").addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = new FormData(event.target).get("token");
  const login = await fetch("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  if (!login.ok) { document.getElementById("view").textContent = "unauthorized"; return; }
  const view = await fetch("/api/view");
  document.getElementById("view").textContent = await view.text();
});
</script>
</body>
</html>`;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === name && value) return value;
  }
  return null;
}

function readToken(body: string): string {
  try {
    const parsed = JSON.parse(body) as { token?: unknown };
    return typeof parsed.token === "string" ? parsed.token : "";
  } catch {
    return "";
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
