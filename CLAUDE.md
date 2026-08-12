# InvestWise CLAUDE.md

Guidelines, commands, and rules for developing on the InvestWise codebase.

## Build and Run Commands

### Development
- **All-in-One Development Launchers**:
  - Windows Batch: `run-dev.bat`
  - Windows PowerShell: `.\start-dev.ps1`
- **Manual Development Run**:
  - Client: `cd client && npm run dev` (starts on port `3000`/`3004`)
  - Server: `cd server && npm run dev` (starts on port `5004`)

### Build
- **Client**: `cd client && npm run build`
- **Server**: `cd server && npm run build`

### Database (Drizzle ORM)
- **Generate Migrations**: `cd server && npm run db:generate`
- **Apply Migrations**: `cd server && npm run db:migrate`
- **Push Schema**: `cd server && npm run db:push`
- **Drizzle Studio**: `cd server && npm run db:studio`

## Test Commands
- **Run Client Tests**: `cd client && npm run test`
- **Run Server Tests (Single run)**: `cd server && npm run test`
- **Run Server Tests (Watch mode)**: `cd server && npm run test:watch`

## Code Style & Conventions

### TypeScript & React (Client)
- **Modules**: Use React 19, TypeScript, and functional components.
- **Styling**: Tailwind CSS (configuration in `client/tailwind.config.js`) paired with modular CSS (e.g. `client/global.css`, `client/premium-ui.css`).
- **Aesthetics**: Premium, modern visual design (custom fonts, tailored gradients, rich dark/light transitions, micro-interactions, responsive down to mobile).
- **Forms**: React Hook Form with Zod schema validation.
- **State**: React Context API for shared app state.

### Node/Express & Drizzle (Server)
- **Structure**: Modular organization under `server/src/modules/` (e.g. Auth, Members, Projects, Funds, Finance, Analytics, Reports, Settings).
- **Routing**: API routes under module files or Vercel serverless functions in `server/api/index.js`.
- **Database Schema**: DB schema defined in `server/src/db/` via Drizzle ORM.
- **Auth**: JWT-based access + refresh tokens. Always secure controller endpoints and check user roles.
- **Logging**: Pinto-based JSON logger.

### General Guidelines
- **HTML/Semantic SEO**: Use semantic elements and ensure fast response times.
- **Verification**: Run TypeScript checks (`npm run typecheck`) and Linting (`npm run lint` on server) before committing.
- **Safety**: Do not commit secrets/private keys. Use `.env` or `.env.local` files.
