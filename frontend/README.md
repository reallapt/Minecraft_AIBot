# MC Remote Bot Frontend

React control panel for the distributed MC bot controller. The frontend is a
static site and is designed to run on a different server from the FastAPI
backend.

## Local development

Requires Node.js 20+ and Corepack.

```powershell
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. With no `VITE_*` variables set, Vite proxies
`/api` and `/ws` to the local backend at `http://127.0.0.1:8000`.

## Separate-server deployment

1. On the frontend server, copy `.env.example` to `.env`.
2. Replace `api.example.com` with the public HTTPS domain of the backend.
3. Build and start the static frontend:

```bash
docker compose up -d --build
```

The container listens directly on port `3000`, for example
`http://192.168.9.5:3000`. Put a TLS reverse proxy in front only when the
panel needs a public HTTPS domain. The API and WebSocket endpoints are
compiled into the bundle at build time, so rebuild the image after changing
either address.

`VITE_API_BASE` must end in `/api/v1`. `VITE_WS_BASE` must point to the
WebSocket base path, for example `wss://api.example.com/ws`.

Do not set `VITE_API_KEY`: Vite exposes all `VITE_*` values in the browser
bundle. Enter the API key only through the control panel's connection settings.

## Checks

```powershell
pnpm lint
pnpm run build
```
