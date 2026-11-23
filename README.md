# Flux — Collaborative IDE in your browser

A real-time collaborative code editor with in-browser execution.

## Quick start

### 1. Worker (live editing and code execution)

```bash
# from the repo root
cp .env.example .env.local
# put your onlinecompiler.io API key in .dev.vars (gitignored):
echo ONLINECOMPILER_API_KEY=your-key > .dev.vars
npm run wrangler
```

Runs on `http://127.0.0.1:8787`. The room Durable Objects sync the editor and run code; `GET /status` reports runs left.

### 2. Frontend (Next.js app)

In a second terminal:

```bash
# from the repo root
npm run dev
```

Opens at `http://localhost:3000`.

## Project structure

```
Flux/                  # Next.js 15 app + the Cloudflare Worker
    ├── party/
    │   ├── server.ts                    # Worker entry, FluxRoom Durable Object (sync + runs code)
    │   ├── limiter.ts                   # Limiter Durable Object (slot cap, daily budget, caches)
    │   └── run/                         # run logic: batching, API calls, errors (unit-tested)
    ├── src/
    │   ├── app/
    │   │   ├── page.tsx                 # Landing hero
    │   │   └── room/[id]/page.tsx       # IDE room
    │   ├── components/
    │   │   ├── ui/
    │   │   │   ├── flux-hero.tsx        # Landing hero
    │   │   │   └── room-panel.tsx       # Create/Join form
    │   │   └── room/
    │   │       └── flux-room.tsx        # Monaco IDE + run panel
    │   └── lib/
    │       ├── compilers.ts             # 12 supported languages
    │       └── flux-monaco.ts           # Custom dark theme
    ├── package.json
    ├── wrangler.jsonc                   # Worker config: Durable Objects, vars
    ├── .dev.vars                        # local Worker secrets (not committed)
    └── tailwind.config.ts
```

## What works now

- **Landing page** (`/`): Hero with video background, create/join room panel
- **Room page** (`/room/[id]`): Monaco editor, language picker, run button, Output/Input tabs
- **Code execution**: the room's Durable Object calls the onlinecompiler.io API (key never exposed to the browser) and shares results with everyone in the room

## Next steps

1. **Real-time sync** — PartyKit + Yjs for shared text and live cursors
2. **Test cases tab** — stdin, expected output, pass/fail with diff
3. **Room expiry** — 2-minute grace when last user disconnects
4. **Presence roster** — Show all connected users in the toolbar

## API key

Get one at https://api.onlinecompiler.io:
1. Sign up
2. Navigate to **API Keys**
3. Create a key (REST API type)
4. Put it in `.dev.vars` as `ONLINECOMPILER_API_KEY=...` (production: `npx wrangler secret put ONLINECOMPILER_API_KEY`)

Free tier handles reasonable usage. For high throughput, consider self-hosting Piston.
