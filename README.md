# Kpocha Touch — Starter Monorepo

This is a **minimal, deployable skeleton** for the Kpocha Touch Unisex Salon app.

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

