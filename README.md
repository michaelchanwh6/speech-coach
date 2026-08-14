# Speech Coach

An AI public-speaking and pitch-practice coach. You speak in front of your
camera; it records voice and video, then gives you instant feedback:

- **Vocal analysis** — speaking pace (WPM vs. a target range for your context),
  filler words, and awkward/rushed pauses, from a Whisper transcript.
- **On-device vision** — how much you faced the camera, positive expression
  (smile), and hand-gesture activity. Video is analyzed in your browser and is
  never uploaded.
- **Coaching** — a warm, specific summary with your strengths and one or two
  things to focus on next, written by a Claude model via the Vercel AI Gateway.

**Stateless by design:** nothing is stored. No accounts, no database. You record,
you get feedback, and the audio is discarded when the request finishes.

## Stack

Next.js (App Router) · OpenAI Whisper (transcription) · Vercel AI Gateway
(feedback) · MediaPipe Tasks Vision (on-device face/hand analysis).

The whole app is one page (`src/app/Coach.tsx`) plus one API route
(`src/app/api/analyze/route.ts`).

## Deploy on Vercel (recommended)

1. Import this repo in the [Vercel dashboard](https://vercel.com/new).
2. Add one environment variable: **`OPENAI_API_KEY`**.
   - The AI Gateway key for coaching feedback is provided **automatically** on
     Vercel via OIDC — you don't need to set it.
3. Deploy. That's it.

## Run locally

```bash
npm install
cp .env.example .env.local   # set OPENAI_API_KEY and AI_GATEWAY_API_KEY
npm run dev
```

Open http://localhost:3000, allow mic/camera, and record. Recording with video
on (the default) includes the on-device expression + gesture signals.

- `AI_GATEWAY_API_KEY` is only needed **locally** (from the AI Gateway tab in
  your Vercel dashboard); in production Vercel supplies it automatically.

## Scripts

- `npm run dev` — dev server
- `npm run build` / `npm start` — production build / serve
- `npm test` — unit tests for the audio-metrics logic (Vitest)

## Notes

- Works on desktop or phone. Recording uses the browser `MediaRecorder` API;
  Chrome/Edge/Firefox are best-supported (Safari is shakier).
