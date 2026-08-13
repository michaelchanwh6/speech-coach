// Pure signal analysis over Whisper's word timestamps. No I/O, no external
// calls — deterministic and unit-tested (see audioMetrics.test.ts). Runs
// server-side in the processing route right after transcription returns.

export type Word = { word: string; start: number; end: number };

export type RecordingContext = "conversational" | "formal" | "interview";

export type WpmWindow = { start: number; end: number; wpm: number };
export type FillerEvent = { word: string; start: number; end: number };
export type PauseEvent = {
  start: number;
  end: number;
  duration: number;
  flag: "awkward" | "ok";
};

export type AudioMetrics = {
  wpmAvg: number;
  wpmWindowed: WpmWindow[];
  fillerCount: number;
  fillerEvents: FillerEvent[];
  pauseEvents: PauseEvent[];
  rushedFlag: boolean;
};

// Target speaking pace by context (words per minute).
export const WPM_TARGETS: Record<
  RecordingContext,
  { min: number; max: number }
> = {
  conversational: { min: 120, max: 150 },
  formal: { min: 130, max: 160 },
  interview: { min: 110, max: 140 },
};

const WINDOW_SEC = 10;
const AWKWARD_PAUSE_SEC = 2.5;
// A pause shorter than this isn't worth surfacing as an event.
const NOTABLE_PAUSE_SEC = 1.0;
// If no gap this long exists anywhere, the delivery had no breathing room.
const BREATH_GAP_SEC = 0.5;

// Single-token fillers. Known limitation: "like", "so", and "right" are also
// ordinary words, so this over-counts — surfaced honestly in the coaching tone
// rather than blocked on a context classifier (see spec §2).
const FILLER_UNIGRAMS = new Set([
  "um",
  "uh",
  "like",
  "so",
  "actually",
  "basically",
  "right",
]);
// Two-token fillers, matched against normalized adjacent word pairs.
const FILLER_BIGRAMS = new Set(["you know", "i mean"]);

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z']/g, "")
    .trim();
}

function computeWpmAvg(wordCount: number, durationSec: number): number {
  if (durationSec <= 0) return 0;
  return Math.round(wordCount / (durationSec / 60));
}

function computeWindows(words: Word[], durationSec: number): WpmWindow[] {
  if (durationSec <= 0) return [];
  const windows: WpmWindow[] = [];
  for (let start = 0; start < durationSec; start += WINDOW_SEC) {
    const end = Math.min(start + WINDOW_SEC, durationSec);
    const count = words.filter((w) => w.start >= start && w.start < end).length;
    const minutes = (end - start) / 60;
    windows.push({
      start,
      end,
      wpm: minutes > 0 ? Math.round(count / minutes) : 0,
    });
  }
  return windows;
}

function detectFillers(words: Word[]): FillerEvent[] {
  const norm = words.map((w) => normalize(w.word));
  const events: FillerEvent[] = [];
  let i = 0;
  while (i < words.length) {
    const bigram = i + 1 < words.length ? `${norm[i]} ${norm[i + 1]}` : "";
    if (bigram && FILLER_BIGRAMS.has(bigram)) {
      events.push({
        word: bigram,
        start: words[i].start,
        end: words[i + 1].end,
      });
      i += 2;
      continue;
    }
    if (FILLER_UNIGRAMS.has(norm[i])) {
      events.push({ word: norm[i], start: words[i].start, end: words[i].end });
    }
    i += 1;
  }
  return events;
}

function detectPauses(words: Word[]): {
  pauseEvents: PauseEvent[];
  rushedFlag: boolean;
} {
  const pauseEvents: PauseEvent[] = [];
  let maxGap = 0;
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap > maxGap) maxGap = gap;
    if (gap >= NOTABLE_PAUSE_SEC) {
      pauseEvents.push({
        start: words[i].end,
        end: words[i + 1].start,
        duration: gap,
        flag: gap > AWKWARD_PAUSE_SEC ? "awkward" : "ok",
      });
    }
  }
  // "Rushed" only means something once there are enough words to have paused.
  const rushedFlag = words.length >= 2 && maxGap <= BREATH_GAP_SEC;
  return { pauseEvents, rushedFlag };
}

export function computeAudioMetrics(
  words: Word[],
  durationSec: number
): AudioMetrics {
  const fillerEvents = detectFillers(words);
  const { pauseEvents, rushedFlag } = detectPauses(words);
  return {
    wpmAvg: computeWpmAvg(words.length, durationSec),
    wpmWindowed: computeWindows(words, durationSec),
    fillerCount: fillerEvents.length,
    fillerEvents,
    pauseEvents,
    rushedFlag,
  };
}
