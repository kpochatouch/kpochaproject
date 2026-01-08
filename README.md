# Kpocha Touch — Starter Monorepo

This is a **minimal, deployable skeleton** for the Kpocha Touch app.

- Frontend: React (Vite), TailwindCSS, React Router, Axios
- Backend: Node.js (Express), CORS, (Mongo-ready but optional), Paystack-ready placeholders
- Deploy: **Vercel** (frontend) & **Render** (backend)

> Set the environment variables in `apps/web/.env` and `apps/api/.env` before running.

## Quickstart

```bash
unzip kpocha-touch-starter.zip -d .
cd kpocha-touch-starter
npm install

# set envs:
# apps/web/.env
# apps/api/.env

# run locally (two terminals)
npm run dev:api
npm run dev:web
```

## Deploy

- **Render** → root: `apps/api` → Start: `node server.js`
- **Vercel** → root: `apps/web` → Build: `npm run build` → Output: `dist`

## WebRTC Calls

We use WebRTC for real-time audio/video calls.

👉 **Implementation notes & debugging guide:**  
See [`docs/webrtc.md`](docs/webrtc.md) for a detailed explanation of:
- why calls failed across networks
- how the “stash + flush” signaling fix works
- a manual regression checklist
