# Speech Coach

An AI public-speaking and pitch-practice coach. You speak in front of your
camera; it records voice and video, then gives you feedback after the session:

- **Vocal analysis** — speaking pace (WPM vs. a target range for your context),
  filler words, and awkward/rushed pauses, from a Whisper transcript.
- **On-device vision** — how much you faced the camera, positive expression
  (smile), and hand-gesture activity. Video is analyzed in your browser and is
  never uploaded for this analysis.
- **Coaching** — a warm, specific summary with your strengths and one or two
  things to focus on next, written by a Claude model via the Vercel AI Gateway.

## Stack

Next.js (App Router) · Supabase (auth + Postgres + storage) · Prisma ·
OpenAI Whisper · Vercel AI Gateway · MediaPipe Tasks Vision.

## Setup

1. **Install:**
   ```bash
   npm install
   ```
2. **Configure env:** copy `.env.example` to `.env.local` and fill in the values.
   You need a Supabase project (URL + publishable key + a pooled/direct
   `DATABASE_URL`/`DIRECT_URL`), an `OPENAI_API_KEY`, and an
   `AI_GATEWAY_API_KEY`.
3. **In Supabase, create a Storage bucket named `recordings`** (private).
4. **Push the schema:**
   ```bash
   npm run db:push
   ```
5. **Run:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, create an account, accept the consent notice,
   and record. Recording with video on is optional — tick the box to include
   the on-device vision signals.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` / `npm start` — production build / serve
- `npm test` — unit tests (audio-metrics logic, via Vitest)
- `npm run db:push` — apply the Prisma schema to your database
- `npm run db:studio` — browse the database

## Notes

- Works on desktop or phone. Recording uses the browser `MediaRecorder` API;
  Chrome/Edge/Firefox are best-supported (Safari is shakier).
- The design and scope are documented in
  [`docs/superpowers/specs/`](docs/superpowers/specs/) and
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
