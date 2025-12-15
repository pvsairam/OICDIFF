# OIC Diff

A tool to compare Oracle Integration Cloud (OIC) archive files and see what changed between two versions.

## What it does

- Upload two `.iar` files and compare them side by side
- See which files were added, removed, or modified
- View integration flows visually with interactive diagrams
- Click on any step to see its details
- Export comparison reports as HTML for sharing

## Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) and import the repo
3. Add these environment variables:
   - `DATABASE_URL` - Your Neon PostgreSQL connection string
   - `ADMIN_PASSWORD` - Password for the database clear function
4. Deploy

## Run locally

1. Clone this repo
2. Install dependencies: `npm install`
3. Set environment variables:
   - `DATABASE_URL` - PostgreSQL connection string
   - `ADMIN_PASSWORD` - Admin password
4. Run migrations: `npm run db:push`
5. Start the app: `npm run dev`

## Built with

- React + TypeScript
- Node.js + Express
- PostgreSQL + Drizzle ORM
- Tailwind CSS
