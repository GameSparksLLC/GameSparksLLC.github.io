import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const clients = new Set();
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const reloadScript = `<script>(()=>{const source=new EventSource("/__dev/reload");source.addEventListener("change",()=>location.reload());})();</script>`;

// Emulate the contact service locally so UI flows can be exercised without sending email.
const handleContactTest = async (request, response) => {
  const json = (data, status) => {
    response.writeHead(status, { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(data));
  };
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let rawBody = "";
  for await (const chunk of request) {
    rawBody += chunk;
    if (Buffer.byteLength(rawBody) > 7000) return json({ error: "Message is too large." }, 413);
  }

  let data;
  try { data = JSON.parse(rawBody); } catch { return json({ error: "Invalid request." }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Invalid request." }, 400);
  if (typeof data._gotcha === "string" && data._gotcha.trim()) return json({ ok: true, test: true }, 200);

  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  const topic = typeof data.topic === "string" ? data.topic.trim() : "";
  const message = typeof data.message === "string" ? data.message.trim() : "";
  const startedAt = Number(data.formStartedAt);
  const age = Date.now() - startedAt;
  const topics = new Set(["Game feedback", "Account or purchase help", "Privacy request", "Business enquiry", "Something else"]);

  if (name.length < 1 || name.length > 80 || /[\r\n]/.test(name)) return json({ error: "Please check your name." }, 400);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\r\n]/.test(email)) return json({ error: "Please check your email address." }, 400);
  if (!topics.has(topic) || message.length < 8 || message.length > 4000) return json({ error: "Please check your topic and message." }, 400);
  if (!Number.isFinite(startedAt) || age < 3500 || age > 30 * 60 * 1000) return json({ error: "Please reload the form and try again." }, 400);
  if (data.turnstileToken !== "XXXX.DUMMY.TOKEN.XXXX") return json({ error: "Please complete the human check and try again." }, 400);

  return json({ ok: true, test: true }, 200);
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://${host}:${port}`);
  if (requestUrl.pathname === "/__dev/reload") {
    response.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    response.on("close", () => clients.delete(response));
    return;
  }
  if (requestUrl.pathname === "/__dev/contact") return handleContactTest(request, response);

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  let filePath = resolve(root, `.${requestedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    if ((await stat(filePath)).isDirectory()) filePath = resolve(filePath, "index.html");
    let body = await readFile(filePath);
    const contentType = contentTypes.get(extname(filePath).toLowerCase()) || "application/octet-stream";
    if (contentType.startsWith("text/html")) {
      body = Buffer.from(body.toString("utf8").replace(/<\/body>/i, `${reloadScript}</body>`));
    }
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Content-Length": body.length,
      "Content-Type": contentType,
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

let reloadTimer;
watch(root, { recursive: true }, (_eventType, filename) => {
  const changedPath = String(filename || "").replaceAll("\\", "/");
  if (!changedPath || changedPath.split("/").some((part) => part === ".git" || part === "node_modules")) return;

  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    clients.forEach((client) => client.write("event: change\ndata: reload\n\n"));
  }, 100);
});

server.listen(port, host, () => {
  console.log(`GameSparks live preview: http://${host}:${port}`);
});
