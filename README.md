# Kpocha Touch — Starter Monorepo

Kpocha Touch is a Nigerian multi-service digital ecosystem that combines professional services, business visibility, social interaction, creator engagement, real-time communication, and marketplace discovery into one platform.

This repository contains the deployable monorepo powering the platform.

- Frontend: React (Vite), TailwindCSS, React Router, Axios
- Backend: Node.js (Express), CORS, (Mongo-ready but optional), Paystack-ready placeholders
- Deploy: **Vercel** (frontend) & **Render** (backend)

> Set the environment variables in `apps/web/.env` and `apps/api/.env` before running.

## Quickstart

unzip kpocha-touch-starter.zip -d .
cd kpocha-touch-starter
npm install

# set envs:

# apps/web/.env

# apps/api/.env

# run locally (two terminals)

npm run dev:api
npm run dev:web

## Deploy

- **Render** → root: `apps/api` → Start: `node server.js`
- **Vercel** → root: `apps/web` → Build: `npm run build` → Output: `dist`

## User documentation

User-facing documentation is available in the `docs/` folder:

- `docs/README.md` — Documentation homepage
- `docs/user-guide.md` — Guide for clients and general users
- `docs/professional-guide.md` — Guide for professionals
- `docs/faq.md` — Frequently asked questions
- `docs/webrtc.md` — WebRTC implementation notes

## WebRTC Calls

We use WebRTC for real-time audio/video calls.

**Implementation notes & debugging guide:**  
See [`docs/webrtc.md`](docs/webrtc.md) for a detailed explanation of:

- why calls failed across networks
- how the “stash + flush” signaling fix works
- a manual regression checklist
