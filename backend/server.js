// Flux backend: holds the onlinecompiler key and proxies /run.
// Zero dependencies — Node 18+ (uses global fetch).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

// Load .env
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  envContent.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const [key, ...valueParts] = trimmed.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").replace(/^["']|["']$/g, "").trim();
      if (!process.env[key]) process.env[key] = value;
    }
  });
}

const API_KEY = process.env.ONLINECOMPILER_API_KEY;
const PORT = Number(process.env.PORT) || 8787;

const COMPILERS = new Set([
  "python-3.14", "typescript-deno", "g++-15", "gcc-15", "openjdk-25",
  "go-1.26", "rust-1.93", "ruby-4.0", "php-8.5", "dotnet-csharp-9",
  "dotnet-fsharp-9", "haskell-9.12",
]);

// Rate limiting: trace requests per IP
const limits = new Map();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

const json = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 250_000) reject(new Error("Body too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

// Sanitize input: remove control characters except newline
const sanitize = (str) => {
  if (typeof str !== "string") return "";
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").substring(0, 100_000);
};

const checkRateLimit = (ip) => {
  const now = Date.now();
  const entry = limits.get(ip);
  if (!entry || now - entry.window > RATE_WINDOW) {
    limits.set(ip, { count: 1, window: now });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
};

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/run") {
    if (!API_KEY || API_KEY === "PASTE_YOUR_KEY_HERE") {
      return json(res, 500, { error: "Set ONLINECOMPILER_API_KEY in backend/.env" });
    }

    // Rate limiting
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    if (!checkRateLimit(ip)) {
      return json(res, 429, { error: "Rate limit exceeded. Try again later." });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return json(res, 400, { error: "Invalid JSON" });
    }

    const { compiler, code, input } = body ?? {};
    if (!COMPILERS.has(compiler)) return json(res, 400, { error: "Unknown compiler" });
    if (typeof code !== "string" || !code.trim()) return json(res, 400, { error: "Code is required" });
    if (code.length > 100_000) return json(res, 400, { error: "Code exceeds 100KB" });
    
    // Validate code is text (no binary)
    if (/[\x00-\x08\x0E-\x1F]/.test(code)) {
      return json(res, 400, { error: "Code contains invalid characters" });
    }

    const stdin = sanitize(input);

    try {
      const upstream = await fetch("https://api.onlinecompiler.io/api/run-code-sync/", {
        method: "POST",
        headers: { Authorization: API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ compiler, code, input: stdin }),
        signal: AbortSignal.timeout(30000), // 30s timeout
      });
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      });
      res.end(await upstream.text());
    } catch (err) {
      if (err.name === "TimeoutError") {
        json(res, 504, { error: "Compilation timed out" });
      } else {
        json(res, 502, { error: "Execution service unreachable" });
      }
    }
    return;
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`flux-backend listening on :${PORT}${API_KEY && API_KEY !== "PASTE_YOUR_KEY_HERE" ? "" : " (no API key set yet)"}`);
});
