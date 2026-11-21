# Flux — Collaborative IDE in your browser

A real-time collaborative code editor with in-browser execution.

## Quick start

### 1. Backend (code execution)

```bash
cd backend
cp .env.example .env
# edit .env and paste your API key from api.onlinecompiler.io
npm run dev
```

Runs on `http://localhost:8788`. Health check: `curl http://localhost:8788/health`.

### 2. Sync server (live editing)

In a second terminal:

```bash
cd frontend
cp .env.example .env.local
npm run wrangler
```

Runs on `http://127.0.0.1:8787`, wrangler dev's default port (which is why the backend uses 8788).

### 3. Frontend (Next.js app)

In a third terminal:

```bash
cd frontend
npm run dev
```

Opens at `http://localhost:3000`.

## Project structure

```
Flux/
├── backend/           # Node server (port 8788)
│   ├── server.js      # /health, /run, /run-tests and /run-tests/plan
│   ├── .env           # API key (not committed)
│   └── package.json
│
└── frontend/          # Next.js 15 app
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
    ├── next.config.mjs                  # Rewrite /api/backend → :8788
    └── tailwind.config.ts
```

## What works now

- **Landing page** (`/`): Hero with video background, create/join room panel
- **Room page** (`/room/[id]`): Monaco editor, language picker, run button, Output/Input tabs
- **Code execution**: Runs through backend → onlinecompiler.io API (key never exposed to browser)

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
4. Paste into `backend/.env`

Free tier handles reasonable usage. For high throughput, consider self-hosting Piston.
