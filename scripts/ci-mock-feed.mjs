import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import http from "node:http";
import process from "node:process";
import { setTimeout } from "node:timers";

const port = Number(process.argv[2] ?? "8787");
const liveFrame = JSON.stringify({
  jsonrpc: "2.0",
  method: "parsedTransactionNotification",
  params: {
    result: {
      context: { slot: 9 },
      value: {
        transaction: {
          signature: "CiLiveEvent1111111111111111111111111111111111111111111111111111",
          slot: 9,
          error: null,
          blockTime: 1700000000,
        },
        instructions: [
          {
            programId: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
            instructionName: "create",
            decoded: {
              accounts: [
                { name: "mint", pubkey: "CiMockMint111111111111111111111111111111111" },
                { name: "bonding_curve", pubkey: "CiMockCurve11111111111111111111111111111111" },
                { name: "user", pubkey: "CiMockUser1111111111111111111111111111111111" },
              ],
            },
          },
        ],
      },
    },
  },
});

function sendText(socket, text) {
  const payload = Buffer.from(text);
  const header = [0x81];
  if (payload.length < 126) header.push(payload.length);
  else if (payload.length < 65536) header.push(126, payload.length >> 8, payload.length & 0xff);
  else return;
  socket.write(Buffer.concat([Buffer.from(header), payload]));
}

const counts = { scan: 0, publicRpc: 0, jupiter: 0, baselineHttp: 0, baselineWs: 0 };
let jupiterSeen = 0;

const server = http.createServer((request, response) => {
  const url = request.url ?? "/";
  if (request.method === "GET" && url.startsWith("/counts")) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(counts));
    return;
  }
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    if (url.startsWith("/v1/parsed-events/scan")) {
      counts.scan += 1;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [],
          scan: { scannedTransactions: 1000, creditsCharged: 11, stoppedOn: "windowEnd" },
        }),
      );
      return;
    }
    if (url.startsWith("/swap/v1/quote")) {
      counts.jupiter += 1;
      jupiterSeen += 1;
      response.setHeader("content-type", "application/json");
      if (jupiterSeen === 1) {
        response.statusCode = 429;
        response.end("{}");
        return;
      }
      response.end(
        JSON.stringify({
          inAmount: "1000000",
          outAmount: "2000000",
          priceImpactPct: "0",
          routePlan: [{}],
        }),
      );
      return;
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    } catch {
      body = {};
    }
    if (url.includes("api-key")) counts.baselineHttp += 1;
    else if (body.method === "getSignaturesForAddress") counts.publicRpc += 1;
    let result = null;
    if (body.method === "getSlot") result = 100;
    else if (body.method === "getSignaturesForAddress") {
      result = [{ signature: "ckpt", slot: 1 }];
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result }));
  });
});

server.on("upgrade", (request, socket) => {
  counts.baselineWs += 1;
  const key = request.headers["sec-websocket-key"];
  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  let buffer = Buffer.alloc(0);
  let sent = false;
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const lengthByte = buffer[1] & 0x7f;
      let offset = 2;
      let length = lengthByte;
      if (lengthByte === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (lengthByte === 127) return;
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      const opcode = buffer[0] & 0x0f;
      buffer = buffer.subarray(offset + length);
      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        const header = Buffer.from([0x8a, payload.length]);
        socket.write(Buffer.concat([header, payload]));
        continue;
      }
      if (opcode !== 0x1) continue;
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch {
        continue;
      }
      if (message.id !== undefined) {
        sendText(socket, JSON.stringify({ jsonrpc: "2.0", id: message.id, result: message.id }));
      }
      if (!sent && typeof message.method === "string" && message.method.includes("Subscribe")) {
        sent = true;
        setTimeout(() => sendText(socket, liveFrame), 300);
      }
    }
  });
});

server.listen(port, "0.0.0.0", () => {
  process.stdout.write(`mock feed listening ${port}\n`);
});
