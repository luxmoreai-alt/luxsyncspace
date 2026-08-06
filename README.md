# LuxSyncspace

LuxSyncspace is Luxmor AI's internal communication workspace for real-time company chat, calendars, meetings, people discovery, and global search.

## Included in this release

- Organization-based secure sign-in with JWT sessions and bcrypt password hashing
- Unified home dashboard with team channels, schedule, and availability
- Team channels with real-time Socket.IO messaging
- Private one-to-one employee messaging
- Invite-link onboarding with automatic employee IDs and company access
- Detailed employee profiles with designation, department, manager, contact details, and joining date
- Role-based group creation for HR, senior leaders, managers, and team leads
- Company announcements restricted to HR and senior leadership
- Work-week calendar, meeting agenda, and event scheduling
- Searchable employee directory with presence and department filters
- Global search across people and channels
- Responsive desktop, tablet, and mobile layouts
- Neon PostgreSQL schema, migrations, indexes, constraints, and Luxmor administrator initialization
- ZeptoMail SMTP delivery of employee usernames and generated temporary passwords
- Mandatory password replacement after an employee's first sign-in
- Security middleware, validation, protected API routes, and production static serving

## Run locally

Requirements: Node.js 20 or newer and a PostgreSQL/Neon connection string.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Configure `.env` from `.env.example`.

3. Initialize and seed the database:

   ```bash
   npm run db:migrate
   npm run db:seed
   ```

4. Start both the React app and Node API:

   ```bash
   npm run dev
   ```

Open `http://localhost:5173`.

Administrator credentials are read from the server-only `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables.

## Production

```bash
npm run build
npm start
```

The Node server serves the built React application and API on `PORT` (default `4000`).

Before a broader company rollout, replace the development JWT secret, rotate credentials that have been shared outside your password manager, configure an approved identity provider if required, and define retention, audit, backup, and compliance policies.

## Structure

```text
apps/client     React + Vite application
apps/server     Express API, Socket.IO, and PostgreSQL data layer
scripts         Integration smoke test
```
