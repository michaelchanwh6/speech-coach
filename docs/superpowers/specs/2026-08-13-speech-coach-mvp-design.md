# Speech Coach MVP — Design Spec

**Date:** 2026-08-13
**Status:** Approved, building in one shot (no separate implementation plan per owner instruction).

## Goal

Turn the current skeleton (auth → consent → record → Whisper transcript) into a
complete, satisfying coaching loop: record a speech, get real coaching feedback
backed by audio metrics **and** lightweight on-device vision signals, on a
results page. Keep it simple and fast to build. Web app, usable on desktop or
phone.

This spec **overrides** two earlier `ARCHITECTURE.md` decisions by explicit
owner choice:
- Feedback is **LLM-generated**, not rule-based templates.
- Scope includes **light vision** (facial expression + hand/gesture presence),
  not audio-only.

## Approved scope decisions

| Decision | Choice |
|---|---|
| Scope | Audio coaching loop **+ light vision** (expression + hand presence) |
| Feedback engine | **LLM** via Vercel AI Gateway (AI SDK v6, `generateObject`), Claude model |
| Results experience | **Per-recording results page only** (no history/trends) |
| Data deletion | **Minimal now**: per-recording delete + 30-day media cleanup cron. Full account deletion deferred. |

## Pipeline

Before: `record → [optional face-facing analysis] → upload → save → transcribe → show raw transcript`.

After: `record → on-device vision analysis → upload → save → server processing (transcript + audio metrics + LLM feedback) → results page`.

Nothing is rewritten; four capabilities bolt onto the skeleton.

## Components

### 1. Audio metrics — `src/lib/analysis/audioMetrics.ts` (server, pure TS)
Input: Whisper word timestamps `[{word,start,end}]`, `durationSec`, `context`.
Output (stored in `Metrics`):
- **Pace:** `wpmAvg` + `wpmWindowed` (10s buckets). Target range by context
  (conversational 120–150, formal 130–160, interview 110–140).
- **Fillers:** lexical match against `um, uh, like, so, you know, actually,
  basically, right, i mean`. `fillerCount` + `fillerEvents`. Known false-positive
  caveat on "like"/"so" documented in code + surfaced honestly in feedback tone.
- **Pauses:** gaps between consecutive words. `pauseEvents` with gaps >2.5s
  flagged `awkward`; `rushedFlag` true when no gap >0.5s exists across the speech.

Pure computation → **unit-tested** (Vitest) with sample word arrays. Runs inside
the processing route right after Whisper returns.

### 2. Vision — `src/lib/vision/analyzeVideo.ts` (client, on-device)
Extends the existing `cameraFacing.ts`. Stays 100% in-browser (video never
leaves the device — matches consent copy). Samples the recorded blob every
300ms and produces three headline numbers:
- **`cameraFacingPct`** — existing head-pose symmetry method (kept).
- **`smilePct`** — from FaceLandmarker `outputFaceBlendshapes`, using
  `mouthSmileLeft` + `mouthSmileRight` above a threshold.
- **`handsVisiblePct`** and **`gestureActivity`** (0–1) — from a MediaPipe
  `HandLandmarker`: fraction of frames with ≥1 hand, and mean landmark movement
  between frames (mapped to low/moderate/high in the UI).

Deliberately shallow: three numbers, not per-frame emotion classification.
Known limitation: frame-by-frame analysis takes ~10–30s on longer clips; covered
by the existing "Analyzing video…" progress state.

### 3. Feedback — `src/lib/analysis/feedback.ts` (server, LLM)
After metrics are computed, send **transcript + all metrics + context** to a
current Claude model through the **Vercel AI Gateway** (AI SDK v6
`generateObject` with a Zod schema). Returns:
```ts
{ summary: string, strengths: string[] /*1–2*/, focusAreas: string[] /*1–2*/ }
```
Stored in the existing `feedback.items` JSON column. Voice: warm, specific,
brief — leads with a genuine win before naming one focus area. Model: Claude
Sonnet (quality); swap to Haiku for cheaper/faster if desired. Requires
`AI_GATEWAY_API_KEY` locally (OIDC-automatic on Vercel). If the feedback call
fails, processing still succeeds with metrics saved and feedback null — the
results page degrades gracefully.

### 4. Processing route — `src/app/api/recordings/[id]/process/route.ts`
Supersedes the current `transcribe` route. Steps: auth + ownership → mark
`processing` → download audio → Whisper → compute audio metrics → **merge** into
the `Metrics` row (which may already hold vision fields written at create time)
→ generate LLM feedback → store → mark `done`. Returns `{ ok, id }`; client
redirects to the results page.

### 5. Results page — `src/app/recordings/[id]/page.tsx` (server component)
Auth + ownership checked. Layout:
- Coaching feedback hero (summary → strengths → focus areas).
- Metric cards: WPM vs. target, filler count (+ examples), pauses, camera-facing
  %, smile %, gesture activity.
- Collapsible transcript.
- **Delete** button (client component calling the delete action).

`Recorder` redirects here on `done` instead of showing the inline transcript.

### 6. Deletion
- **Per-recording:** server action `deleteRecording(id)` — ownership check →
  remove storage object → delete `Recording` (cascades transcript/metrics/
  feedback) → redirect to `/record`.
- **30-day cleanup:** `src/app/api/cron/cleanup/route.ts`, secured by
  `CRON_SECRET`. Finds recordings past `audioExpiresAt` with media still
  present, deletes the **storage file only**, and nulls `audioUrl` (transcript +
  metrics persist per retention policy). Scheduled daily via `vercel.json` cron.

## Schema changes (`prisma/schema.prisma`)
- `Metrics`: add nullable `smilePct Float?`, `handsVisiblePct Float?`,
  `gestureActivity Float?`.
- `Recording`: make `audioUrl String?` nullable (so cleanup can null it after
  deleting media while keeping the row).

One `prisma db push` on deploy. `prisma generate` locally so client types update.

## Dependencies
- Add `ai` (Vercel AI SDK v6) + `zod` (structured output schema).
- Add `vitest` (dev) + a `test` script for the audio-metrics unit tests.
- MediaPipe (`@mediapipe/tasks-vision`) already installed.

## Env additions (`.env.example`)
- `AI_GATEWAY_API_KEY` — Vercel AI Gateway (feedback LLM).
- `CRON_SECRET` — protects the cleanup cron route.

## Testing
- **Unit (Vitest):** `audioMetrics.ts` — WPM (avg + windows), filler detection
  incl. known false positives, pause/awkward/rushed detection.
- Vision + LLM verified manually for MVP (hard to unit-test meaningfully).

## Explicitly out of scope (deferred)
History list, trend charts, full account deletion, per-frame emotion/gesture
event timelines, Safari-specific hardening.
