# AI Speech Coach — Architecture & MVP Plan

Web app (browser-first), MVP scope: audio-only, post-recording feedback on pace, filler words, and pauses.

## 1. Tech stack

| Layer | Choice | Why | Tradeoff |
|---|---|---|---|
| Frontend | Next.js (React + TypeScript), App Router | One codebase for UI + API routes, avoids standing up a separate backend service for MVP, good SSR for dashboard/history pages | Locks you into Vercel-shaped deploy conventions (though it self-hosts fine); would need to peel API routes into their own service if you outgrow serverless function limits |
| Audio capture | Browser `MediaRecorder` API, `audio/webm;codecs=opus` | Zero native deps, works in Chrome/Edge/Firefox without install | Safari's MediaRecorder support is shakier (format/codec quirks) — budget time to test on Safari specifically, or gate it with a feature check |
| ASR | **OpenAI Whisper API** (`whisper-1` or `gpt-4o-transcribe`), `timestamp_granularities: ["word"]` | Best accuracy-for-effort tradeoff on accented/noisy speech (see §2), word-level timestamps out of the box, no infra to run | Per-minute cost, network round-trip latency, and raw audio leaves your infra to a third party — this is a privacy decision, flagged below |
| Backend | Next.js API routes (Node/TypeScript) | Same language as frontend, no separate deploy for MVP | Cold starts / execution-time limits on serverless hosts if a transcription request runs long — may need a queue (see §3) before this bites |
| Database | Postgres (managed, e.g. Supabase/RDS) via Prisma | Relational fit for users→recordings→transcripts→metrics; Prisma keeps migrations sane as the schema grows | None significant at this scale |
| Object storage | S3-compatible (Cloudflare R2 or S3) for audio files | Cheap, signed-URL upload/download, decoupled from app servers | You must own the retention/deletion lifecycle yourself (see §5) |
| Auth | Whatever you already use, or Supabase Auth / Clerk if starting fresh | Not the interesting part of this build — don't roll your own | — |
| Signal analysis | Plain TypeScript over Whisper's word timestamps (no separate audio ML lib for MVP) | WPM and pauses are derivable directly from word start/end times — no need for a waveform/VAD library to hit MVP scope | Whisper's timestamps are approximate around silence; this can misjudge pause boundaries in noisy recordings (see §3) |

## 2. ASR decision: Whisper API vs. on-device

You asked me to actually decide, so: **cloud Whisper API for MVP**, with a documented path off it. Reasoning:

| Approach | Accuracy (incl. accents/noise) | Latency | Cost | Privacy |
|---|---|---|---|---|
| **OpenAI Whisper API** (chosen) | Best-in-class for accented/non-studio audio — trained on 680k hours of multilingual/multi-accent data | ~seconds to tens of seconds depending on clip length + upload | ~$0.006/min audio — a 3-min practice speech costs less than a cent | Raw audio sent to OpenAI. Per their API data-use policy this isn't used for model training and isn't retained beyond abuse-monitoring windows, but it does leave your infrastructure — must be disclosed in the consent flow |
| Self-hosted Whisper (e.g. `faster-whisper` on a GPU box) | Same model quality as above, you control it | Depends entirely on your compute — can be worse than the API unless you provision a GPU | Compute cost instead of per-minute fee — cheaper at high volume, more expensive at low volume (idle GPU) | Best of the server-side options — audio never leaves infra you control. **Revisit this once you have volume or an enterprise privacy requirement.** |
| On-device (WASM, e.g. `whisper.cpp`/transformers.js in-browser) | Noticeably worse on accents/background noise at model sizes small enough to run in-browser (tiny/base) | No network round-trip, but slow local inference (seconds-to-minutes on modest laptops) | Free at inference, but a multi-hundred-MB model download on first use | Best possible privacy — audio never leaves the device at all | 
| Browser `SpeechRecognition` (Web Speech API) | Poor, inconsistent across browsers, no reliable word timestamps | Fast | Free | Varies by browser vendor (often cloud-backed anyway, e.g. Chrome routes through Google) |

**Why not on-device now:** your non-negotiable is ASR robustness for accents and imperfect environments — that's precisely where small on-device models degrade most. Cloud Whisper is the only option in this table that's simultaneously accurate on that population *and* shippable without a training/ops investment. On-device becomes attractive later as a privacy-tier upgrade, not as the MVP default.

**Flag now:** disclose in the consent screen that audio is sent to OpenAI for transcription, link their data-use terms, and don't claim "processed entirely on our servers."

## 3. Signal analysis pipeline

Whisper's `words` array (`{word, start, end}`) is the only input needed for all three MVP metrics:

- **Pace (WPM):** `word_count / (duration_minutes)`, computed both as a whole-speech average and in rolling windows (e.g. 10s) so you can flag *where* in the speech pace spiked — this is what makes feedback like "you hit 190 WPM around the 40s mark" possible. Target range is a lookup by user-selected context:
  - Conversational: 120–150 WPM
  - Formal presentation: 130–160 WPM (the default)
  - Interview: 110–140 WPM (interviews reward more deliberate pacing)
- **Filler words:** lexical match of each transcript word/short n-gram against a filler list (`um, uh, like, so, you know, actually, basically, right, I mean`). **Known MVP limitation to flag:** "like" and "so" are also legitimate words ("I like pizza," "so, in conclusion...") — naive matching produces false positives. Ship it with this caveat rather than delaying for an n-gram/context classifier; note it as the first thing to refine post-MVP if user feedback complains about false flags.
- **Pauses:** gap between `word[i].end` and `word[i+1].start`. Flag gaps > ~2.5s as "awkward pause," and flag a *lack* of any gap > ~0.5s across an entire speech as "rushed delivery, no breathing room." **Caveat to flag:** Whisper's timestamps can be imprecise across silence (it sometimes swallows or misplaces gaps in noisy audio), so pause detection will be noisier than WPM. If this proves unreliable in testing, the next step is a dedicated VAD pass (e.g. WebRTC VAD) cross-referenced against the transcript — deliberately deferred out of MVP since word-timestamp gaps are cheaper to ship and may be good enough.

This analysis is pure computation (no external calls), so it runs synchronously in the API route right after the Whisper response returns — no separate job needed at MVP scale. If clip lengths grow or you add a queue for other reasons, this step rides along in the same job.

## 4. Feedback generation architecture

Deliberately **not** an LLM call for MVP — a rule-based scorer gives you deterministic, reviewable output and keeps the "coach, not drill sergeant" voice consistent, which an LLM free-text call would risk drifting on. Structure, designed so a new metric (e.g. vocal tone later) doesn't require touching selection/copy logic:

```
metric evaluators (one per metric: pace, filler, pauses)
  → each takes computed metrics, returns candidate Observations:
    { metric: "pace", valence: "positive"|"improve", severity: 0-1, data: {...} }
       ↓
selector
  → sorts candidates by severity
  → enforces the product rule: always include ≥1 positive observation first,
    at most 1 "improve" observation, max 2 total
       ↓
copy layer
  → templates per (metric, valence) pair, written in one consistent coach voice
  → fills in the specific data (e.g. "190 WPM around the 40s mark")
```

Adding a future metric = write one evaluator + its templates. Selector and copy layer don't change. This is the extensibility answer to your architecture question #3.

**Voice, decided up front (per your instruction not to let this drift feature-by-feature):** warm, specific, brief. Every feedback message leads with a genuine win before naming the one focus area. No clinical metric-dumps in the coach-facing copy — the underlying numbers are still available on a "details" view for users who want them, but the headline is always ≤2 sentences, ≤2 items.

## 5. Data model

```
users
  id, email, created_at, retention_preference

recordings
  id, user_id, created_at, audio_url, duration_sec,
  context            -- 'conversational' | 'formal' | 'interview'
  status             -- 'uploaded' | 'processing' | 'done' | 'failed'
  audio_expires_at   -- retention timer, see §6

transcripts
  id, recording_id, full_text, language,
  words   jsonb   -- [{word, start, end, confidence}]

metrics
  id, recording_id,
  wpm_avg, wpm_windowed        jsonb  -- [{start,end,wpm}]
  filler_count, filler_events  jsonb  -- [{word, start, end}]
  pause_events                 jsonb  -- [{start, end, duration, flag: 'awkward'|'ok'}]
  rushed_flag                  boolean

feedback
  id, recording_id, generated_at,
  items   jsonb   -- up to 2: [{metric, valence, message}]
```

No separate "progress" table for MVP — trends (WPM over time, filler count over time) are cheap to compute on the fly with a `GROUP BY` over `metrics` joined to `recordings` for a given user, indexed on `(user_id, created_at)`. Add a materialized snapshot table only if that query becomes a bottleneck — premature at MVP user counts.

## 6. Privacy & retention (flagged per your constraint, not waiting to be asked)

- **Consent flow:** required before first recording — mic permission prompt is necessary but not sufficient. Show an explicit screen: what's recorded, that audio is sent to OpenAI for transcription, how long raw audio is kept, and a link to a real (short) privacy policy. Log consent with a timestamp.
- **Retention default:** raw audio auto-deleted 30 days after processing completes, configurable per-user (shorter allowed, longer requires explicit opt-in). Transcripts + metrics (much less sensitive, no biometric voiceprint) persist indefinitely for progress tracking unless the user deletes their account.
- **Why this matters legally, not just ethically:** voice recordings are treated as biometric data in some jurisdictions (e.g. Illinois BIPA) — minimal retention and a working deletion path aren't optional polish, they're the difference between a manageable compliance surface and an unmanageable one.
- **Deletion:** a real "delete my data" action must cascade audio (object storage) + DB rows, not just soft-delete a flag.
- **Third-party exposure:** OpenAI receives raw audio per §2 — this is the single biggest privacy fact about this architecture and should be first in the consent copy, not buried in a linked policy doc.

## 7. Build order

1. Recording + upload (MediaRecorder → object storage) + consent screen gating first use
2. Transcription (Whisper API call, store `transcripts`)
3. Signal analysis (WPM/filler/pause computation from word timestamps → `metrics`)
4. Feedback layer (evaluators → selector → copy)
5. Progress tracking (history view, on-the-fly trend queries)

Open items I'd like your sign-off on before I start coding step 1:
- Confirm Postgres host (Supabase is the fastest path if you don't already have one)
- Confirm object storage (R2 vs S3 — R2 has no egress fee, cheaper if users re-download audio often)
- Auth: do you have an existing provider, or should I default to Supabase Auth for MVP simplicity?
