# The Boys Tipping

An Astro app for running an NRL tipping competition with groups, tips, joker rounds, and Neon-backed data.

## Tech Stack

- Astro 6
- Astro Node adapter
- Drizzle ORM
- Neon Postgres

## Requirements

- Node.js 22.12.0 or newer
- npm 9.6.5 or newer
- A Neon database connection string

## Setup

Install dependencies:

```bash
npm install
```

Create local environment files from the example:

```bash
cp .env.example .env
cp .env.example .env.development
```

Update `.env` and `.env.development` with your Neon values:

- `DATABASE_URL`
- `DIRECT_DATABASE_URL`
- `PUBLIC_NEON_AUTH_URL`
- `PUBLIC_APP_ENV`

## Development

Start the local dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:4321/
```

Stop the dev server with `Ctrl+C`.

If the dev server appears to hang immediately after `astro dev`, reinstall dependencies from the lockfile:

```bash
npm ci
```

## Build

Build the app for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Database

Generate migrations:

```bash
npm run db:generate
```

Run migrations using the default environment:

```bash
npm run db:migrate
```

Run development migrations using `.env.development`:

```bash
npm run db:migrate:dev
```

Seed the development database:

```bash
npm run db:seed:dev
```

Run the full development database setup:

```bash
npm run db:setup:dev
```

Open Drizzle Studio:

```bash
npm run db:studio
```

## Git Workflow

Create a branch for each change:

```bash
git switch -c feature/my-change
```

Commit and push the branch:

```bash
git add .
git commit -m "Describe the change"
git push -u origin feature/my-change
```

Open a pull request on GitHub and wait for checks or CodeRabbit review before merging.
