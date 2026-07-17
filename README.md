<div align="center">
  <img width="1200" height="475" alt="InvestWise banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# InvestWise

<p align="center">
  Enterprise investment management for teams that need clean operations, strong access control, and a polished portfolio workflow.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Express-5.x-000000?logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/PostgreSQL-Supabase-336791?logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Vercel-deploy-000000?logo=vercel&logoColor=white" alt="Vercel" />
</p>

## Overview

InvestWise is a full-stack investment management platform for tracking members, projects, funds, transactions, expenses, dividends, and reporting in one place.

The app is built around:

- A React + Vite frontend with a premium enterprise UI
- An Express + TypeScript API with JWT auth and role-based access control
- PostgreSQL via Drizzle ORM and Supabase-compatible environment variables
- Security, session refresh, and backup workflows designed for operational use

## Key Capabilities

- Member management with profile, access, and financial context
- Project and fund workflows for portfolio operations
- Deposits, expenses, earnings, transfers, dividends, and reconciliation
- Analytics, reports, and audit-oriented views
- Secure authentication with token refresh and auto-redirect to login on unauthorized sessions
- Dark-mode friendly interface with responsive layouts and animated interactions
- Optional AI advisor experience in the client shell
- Backup cron support via the included Vercel config

## Table Of Contents

- [Overview](#overview)
- [Key Capabilities](#key-capabilities)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Local Setup](#local-setup)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Deployment](#deployment)
- [Documentation](#documentation)
- [Troubleshooting](#troubleshooting)

## Tech Stack

| Layer | Tools |
| --- | --- |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS |
| UI / Motion | Framer Motion, Lucide React, Recharts |
| Forms / Validation | React Hook Form, Zod |
| State / Data | React Context, Axios |
| Backend | Node.js 20+, Express 5, TypeScript |
| Database | PostgreSQL, Drizzle ORM |
| Auth | JWT access + refresh tokens |
| Security | Helmet, rate limiting, request validation |
| Logging / Ops | Pino, health checks, cron backup endpoint |
| Testing | Vitest, Testing Library, jsdom |
| Deployment | Vercel config included |

## Architecture

InvestWise is split into two main applications:

```text
investwise_web_app/
├── client/                 # React frontend
│   ├── components/         # Screens, dialogs, layout, and feature modules
│   ├── context/            # Shared application state
│   ├── hooks/              # Reusable client hooks
│   ├── services/           # API client and integrations
│   ├── i18n/               # Language strings and translation helpers
│   └── utils/              # Form and validation helpers
├── server/                 # Express API
│   ├── src/modules/        # Auth, analytics, finance, reports, settings, etc.
│   ├── src/db/             # Schema and database definitions
│   └── api/                # Vercel serverless entrypoint
├── docs/                   # Setup, deployment, security, and implementation notes
├── run-dev.bat             # Windows launcher for both apps
├── start-dev.ps1           # PowerShell launcher for both apps
└── vercel.json             # API routing + backup cron config
```

### Main Domain Modules

| Module | Purpose |
| --- | --- |
| Auth | Login, logout, refresh tokens, profile access, session handling |
| Members | Partner/member records and related management flows |
| Projects | Project lifecycle and investment activity tracking |
| Funds | Fund administration and balances |
| Finance | Deposits, expenses, earnings, transfers, dividends, reconciliation |
| Analytics | Portfolio and operational metrics |
| Reports | Export and reporting workflows |
| Audit | Audit-oriented visibility and notifications |
| Goals | Target tracking and progress views |
| Settings | System configuration and RBAC controls |

## Local Setup

### Prerequisites

- Node.js 20 or newer
- npm
- A PostgreSQL database compatible with the `DATABASE_URL` in `server/.env.example`
- Optional: Supabase account for hosted Postgres and auth/storage-related values

### 1) Install Dependencies

Install the two packages separately:

```bash
cd client
npm install

cd ../server
npm install
```

### 2) Configure Environment Variables

Copy the example files:

```bash
cp client/.env.example client/.env.local
cp server/.env.example server/.env
```

If you are on Windows PowerShell:

```powershell
Copy-Item client/.env.example client/.env.local
Copy-Item server/.env.example server/.env
```

Update these values first:

- `client/.env.local`
  - `VITE_API_URL`
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`

- `server/.env`
  - `PORT`
  - `DATABASE_URL`
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_PUBLISHABLE_KEY`
  - `JWT_SECRET`
  - `JWT_REFRESH_SECRET`
  - `CORS_ORIGINS`

Optional server variables used by operational features:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `BACKUP_RETENTION_DAYS`
- `CRON_SECRET`
- `IPINFO_TOKEN`
- `NOTIFICATION_WEBHOOK_URL`
- `EMAIL_HOST`
- `EMAIL_PORT`
- `EMAIL_USER`
- `EMAIL_PASS`

### 3) Start the App

Recommended on Windows:

```bash
run-dev.bat
```

Or with PowerShell:

```powershell
.\start-dev.ps1
```

Manual startup:

```bash
# Backend
cd server
npm run dev

# Frontend
cd ../client
npm run dev
```

Expected local URLs:

- Frontend default: `http://localhost:3000`
- Frontend launcher port: `http://localhost:3004`
- Backend: `http://localhost:5004`
- Health check: `http://localhost:5004/api/health`

## Environment Variables

### Client

| Variable | Purpose | Example |
| --- | --- | --- |
| `VITE_API_URL` | Backend API base URL | `http://localhost:5004/api` |
| `VITE_SUPABASE_URL` | Supabase project URL | `https://[PROJECT].supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Client-side Supabase anon key | `your-anon-key` |

### Server

| Variable | Purpose | Example |
| --- | --- | --- |
| `NODE_ENV` | Runtime mode | `development` |
| `PORT` | API port | `5004` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://...` |
| `SUPABASE_URL` | Supabase project URL | `https://[PROJECT].supabase.co` |
| `SUPABASE_ANON_KEY` | Supabase anon key | `your-anon-key` |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key | `your-publishable-key` |
| `JWT_SECRET` | Access token secret | `your-secret` |
| `JWT_REFRESH_SECRET` | Refresh token secret | `your-refresh-secret` |
| `CORS_ORIGINS` | Allowed browser origins | `http://localhost:3000,http://localhost:3004` |
| `R2_ACCOUNT_ID` | Cloudflare R2 account id | `your-account-id` |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key | `your-access-key-id` |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key | `your-secret-access-key` |
| `R2_BUCKET_NAME` | Backup bucket name | `investwise-backups` |
| `BACKUP_RETENTION_DAYS` | Backup retention policy | `30` |

## Scripts

### Client

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Build the frontend for production |
| `npm run preview` | Preview the production build locally |
| `npm run test` | Run the client test suite |

### Server

| Command | Description |
| --- | --- |
| `npm run dev` | Start the backend in watch mode |
| `npm run build` | Type-check and build the server bundle |
| `npm run start` | Start the backend without watch mode |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply migrations |
| `npm run db:push` | Push schema changes |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run test` | Run server tests once |
| `npm run test:watch` | Run server tests in watch mode |
| `npm run lint` | Lint server source |
| `npm run typecheck` | Run TypeScript type checking |

## Deployment

The repository includes a Vercel configuration at [`vercel.json`](vercel.json).

It currently:

- Routes `/api/*` to `server/api/index.js`
- Schedules a daily backup cron at `02:00 UTC` via `/api/backup/cron`

If you deploy elsewhere, keep these points aligned:

- The client must point `VITE_API_URL` at the deployed API
- The backend must receive the same `DATABASE_URL`, JWT secrets, and CORS origins used in production
- Any backup or notification features need their matching secrets configured in the target environment

## Documentation

Helpful references in `docs/`:

- [`docs/SETUP.md`](docs/SETUP.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/SECURITY.md`](docs/SECURITY.md)
- [`docs/ENV_SETUP_GUIDE.md`](docs/ENV_SETUP_GUIDE.md)
- [`docs/QUICK_REFERENCE.md`](docs/QUICK_REFERENCE.md)

## Troubleshooting

### The app keeps redirecting to login

- Confirm `JWT_SECRET` and `JWT_REFRESH_SECRET` are set correctly
- Confirm `DATABASE_URL` points to the expected database
- Verify `CORS_ORIGINS` includes your local frontend origin
- Clear the browser storage for the app and sign in again

### Frontend cannot reach the backend

- Verify `VITE_API_URL` points to the backend API
- Ensure the backend is running on the expected port
- Check that your browser origin is present in `CORS_ORIGINS`

### Port already in use

- Stop other apps using `3000`, `3004`, or `5004`
- Use `run-dev.bat` or `start-dev.ps1` to let the launcher clear common conflicts

### Database connection errors

- Check the `DATABASE_URL` format
- Confirm the database allows connections from your current network
- Re-run the server after updating `.env`

---

InvestWise is structured to be readable, secure, and easy to operate.
