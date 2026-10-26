# Dropnote

A tiny shared clipboard built with Astro, Tailwind CSS, shadcn/ui patterns, and Supabase.

## Run locally

```sh
npm install
npm run dev
```

Without Supabase credentials, rooms are stored in this browser only. To share rooms across devices:

1. Create a free Supabase project.
2. Run [`supabase/setup.sql`](supabase/setup.sql) in the Supabase SQL editor.
3. Copy `.env.example` to `.env` and add your project URL and publishable (or legacy anon) key.
4. Restart the dev server.

Supabase Realtime broadcasts a small refresh event when notes are added. The note content remains in Postgres and is fetched through the room-code functions.

Five-character room codes are convenient shared passcodes, not strong authentication. Don't put passwords, private keys, or sensitive data in a room. For longer-term public use, add rate limiting and a longer secret room token.

## Build

```sh
npm run build
```
