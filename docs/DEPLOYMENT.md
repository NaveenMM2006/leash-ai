# Leash Deployment & Production Guide

This guide details how to deploy the Leash firewall to production.

---

## Architecture Overview

```
                      ┌──────────────────────────────────────┐
                      │    Reverse Proxy (Nginx / Cloud)     │
                      └──────────────┬───────────────────────┘
                                     │
               ┌─────────────────────┴─────────────────────┐
               ▼                                           ▼
      / (Dashboard SPA)                             /api/* (REST API)
  ┌───────────────────────┐                     ┌────────────────────────┐
  │   Vite React Build    │                     │  Express Server (:4000)│
  │  (Static HTML/JS/CSS) │                     │     (Node.js 22+)      │
  └───────────────────────┘                     └───────────┬────────────┘
                                                            │
                                         ┌──────────────────┴──────────────────┐
                                         ▼                                     ▼
                                PostgreSQL / Neon DB                 PayPal Sandbox API
```

- **Same-Origin Security**: Dashboard requests use `credentials: 'same-origin'` and session cookies. The frontend and backend must be exposed under the same public origin (e.g. via Nginx, Vercel rewrites, or Cloudflare).
- **Database Connectivity**: Neon PostgreSQL uses WebSocket connections over standard HTTPS port 443 (via `@prisma/adapter-neon`), preventing firewall timeouts on port 5432. Standard PostgreSQL uses TCP port 5432 (via `@prisma/adapter-pg`).

---

## 1. Quick Prerequisites

1. **PostgreSQL Database**:
   - E.g. [Neon Serverless Postgres](https://neon.tech) (already supported with WebSocket adapter) or managed Postgres (AWS RDS, Supabase, Railway).
2. **PayPal Sandbox App**:
   - Log into [developer.paypal.com](https://developer.paypal.com) -> Apps & Credentials.
   - Create a Sandbox app to get `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`.
3. **Anthropic API Key** (optional for basic rules, required for AI intent verification):
   - Get an API key from [console.anthropic.com](https://console.anthropic.com).

---

## 2. Deployment Methods

### Option A: Docker Compose (VPS / EC2 / Droplet) — Recommended

This spins up the production Node.js API server and an Nginx reverse proxy serving the compiled React dashboard and routing `/api/*` to the server.

1. **Clone repository and configure `.env`**:
   ```bash
   cp .env.production.example .env
   # Edit .env with your real DATABASE_URL, WEB_ORIGIN, and credentials
   ```

2. **Run database migrations**:
   ```bash
   npm run db:deploy -w @leash/server
   ```

3. **Build the dashboard assets**:
   ```bash
   npm run build -w @leash/web
   ```

4. **Launch containers**:
   ```bash
   docker compose -f docker-compose.prod.yml up -d --build
   ```

5. **Verify**:
   - `http://YOUR-SERVER-IP/healthz` -> `{"status":"ok",...}`
   - `http://YOUR-SERVER-IP/readyz` -> `{"status":"ready","checks":{"database":"ok"}}`

---

### Option B: Render or Railway (PaaS 1-Click)

#### Backend Service (Web Service):
1. Create a **New Web Service** pointing to this repository.
2. Settings:
   - **Environment**: Node
   - **Build Command**: `npm ci && npm run db:generate -w @leash/server && npm run build -w @leash/server`
   - **Start Command**: `npm run start -w @leash/server`
3. Environment Variables:
   - `NODE_ENV`: `production`
   - `HOST`: `0.0.0.0`
   - `PORT`: `4000` (or leave default on platforms that inject PORT)
   - `TRUST_PROXY`: `true`
   - `DATABASE_URL`: `postgresql://...`
   - `WEB_ORIGIN`: URL of your frontend dashboard (e.g. `https://leash-dashboard.vercel.app`)
   - `PAYPAL_ENV`: `sandbox`
   - `PAYPAL_CLIENT_ID`: `...`
   - `PAYPAL_CLIENT_SECRET`: `...`

#### Frontend Service (Vercel / Netlify / Render Static):
If deploying frontend separately on Vercel:
1. Root Directory: `apps/web`
2. Build Command: `npm run build`
3. Output Directory: `dist`
4. Update `apps/web/vercel.json` with your deployed backend URL:
   ```json
   {
     "rewrites": [
       { "source": "/api/:path*", "destination": "https://your-backend.onrender.com/api/:path*" },
       { "source": "/healthz", "destination": "https://your-backend.onrender.com/healthz" },
       { "source": "/readyz", "destination": "https://your-backend.onrender.com/readyz" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

---

## 3. Production Readiness Checklist

| Item | Status / Note |
|---|---|
| **Zero hardcoded credentials** | Verified. Credentials loaded strictly from environment. |
| **Fail-closed security** | Verified. Untrusted or invalid inputs default to ESCALATE/BLOCK. |
| **Port 5432 firewall tolerance** | Auto-detected. Uses WebSocket port 443 for Neon DB. |
| **Secure Cookies** | Active in production (`NODE_ENV=production` sets `secureCookie: true`). |
| **Reverse Proxy Awareness** | Configurable via `TRUST_PROXY=true` for correct client IP & rate limiting. |
| **Health Checks** | `/healthz` (liveness) & `/readyz` (readiness with DB probe) available. |
| **Audit Logs** | Append-only hash-chained audit events written to PostgreSQL. |

