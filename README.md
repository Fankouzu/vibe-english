# Vibe English

A local and deployable English vocabulary practice app generated from the word classification document. It includes word drills, separate phrase drills, student login, progress tracking, and mastery-based review.

## Local SQLite mode

```bash
python3 app/server.py --port 4173
```

Open `http://127.0.0.1:4173/app/index.html`.

## Vercel + Turso mode

The Vercel deployment uses Node serverless functions in `api/` and Turso/libSQL for the free persistent database.

Required Vercel environment variables:

```text
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

Vercel settings:

- Framework Preset: Other
- Root Directory: project root
- Build Command: empty
- Output Directory: empty
- Install Command: `npm install`

## Tests

```bash
npm test
npm run check
python3 -m unittest app/server_test.py
```

## Important files

- `app/`: static frontend and local Python SQLite server.
- `api/`: Vercel serverless API backed by Turso.
- `build/word_entries.json`: structured vocabulary entries.
- `outputs/word-classified-excel/`: printable A4 landscape Excel workbook.
