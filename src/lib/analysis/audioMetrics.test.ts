import { describe, it, expect } from "vitest";
import { computeAudioMetrics, type Word } from "./audioMetrics";

// Build a word list at a steady cadence: `count` words, each `dur` long with
// `gap` of silence between them, starting at `t0`.
function steadyWords(
  count: number,
  { dur = 0.3, gap = 0.1, t0 = 0, text = "word" } = {}
): Word[] {
  const words: Word[] = [];
  let t = t0;
  for (let i = 0; i < count; i++) {
    words.push({ word: text, start: t, end: t + dur });
    t += dur + gap;
  }
  return words;
}

describe("computeAudioMetrics — pace", () => {
  it("computes average WPM as words over duration in minutes", () => {
    // 150 words over 60s => 150 WPM.
    const words = steadyWords(150);
    const m = computeAudioMetrics(words, 60);
    expect(m.wpmAvg).toBe(150);
  });

  it("returns 0 WPM for non-positive duration instead of dividing by zero", () => {
    const m = computeAudioMetrics(steadyWords(10), 0);
    expect(m.wpmAvg).toBe(0);
    expect(m.wpmWindowed).toEqual([]);
  });

  it("buckets pace into 10s windows", () => {
    // 30 words evenly across 30s => 3 windows of 10 words => 60 WPM each.
    const words: Word[] = Array.from({ length: 30 }, (_, i) => ({
      word: "w",
      start: i, // one word per second
      end: i + 0.2,
    }));
    const m = computeAudioMetrics(words, 30);
    expect(m.wpmWindowed).toHaveLength(3);
    expect(m.wpmWindowed[0]).toMatchObject({ start: 0, end: 10, wpm: 60 });
    expect(m.wpmWindowed[2]).toMatchObject({ start: 20, end: 30, wpm: 60 });
  });
});

describe("computeAudioMetrics — fillers", () => {
  it("detects single-word fillers", () => {
    const words: Word[] = [
      { word: "So", start: 0, end: 0.3 },
      { word: "um", start: 0.5, end: 0.8 },
      { word: "hello", start: 1.0, end: 1.4 },
      { word: "uh", start: 1.6, end: 1.9 },
    ];
    const m = computeAudioMetrics(words, 2);
    expect(m.fillerCount).toBe(3);
    expect(m.fillerEvents.map((f) => f.word)).toEqual(["so", "um", "uh"]);
  });

  it("detects two-word fillers as a single event", () => {
    const words: Word[] = [
      { word: "you", start: 0, end: 0.2 },
      { word: "know", start: 0.25, end: 0.5 },
      { word: "I", start: 0.7, end: 0.8 },
      { word: "mean", start: 0.85, end: 1.1 },
      { word: "yes", start: 1.3, end: 1.6 },
    ];
    const m = computeAudioMetrics(words, 2);
    expect(m.fillerEvents.map((f) => f.word)).toEqual(["you know", "i mean"]);
    // The bigram spans from the first token's start to the second's end.
    expect(m.fillerEvents[0]).toMatchObject({ start: 0, end: 0.5 });
  });

  it("strips punctuation and casing before matching", () => {
    const words: Word[] = [
      { word: "Um,", start: 0, end: 0.3 },
      { word: "right?", start: 0.5, end: 0.8 },
    ];
    const m = computeAudioMetrics(words, 1);
    expect(m.fillerCount).toBe(2);
  });
});

describe("computeAudioMetrics — pauses", () => {
  it("flags gaps over 2.5s as awkward", () => {
    const words: Word[] = [
      { word: "one", start: 0, end: 0.5 },
      { word: "two", start: 4.0, end: 4.5 }, // 3.5s gap
    ];
    const m = computeAudioMetrics(words, 5);
    expect(m.pauseEvents).toHaveLength(1);
    expect(m.pauseEvents[0]).toMatchObject({ flag: "awkward" });
    expect(m.pauseEvents[0].duration).toBeCloseTo(3.5);
  });

  it("records notable-but-ok pauses between 1s and 2.5s", () => {
    const words: Word[] = [
      { word: "one", start: 0, end: 0.5 },
      { word: "two", start: 2.0, end: 2.5 }, // 1.5s gap
    ];
    const m = computeAudioMetrics(words, 3);
    expect(m.pauseEvents).toHaveLength(1);
    expect(m.pauseEvents[0].flag).toBe("ok");
  });

  it("sets rushedFlag when no gap exceeds the breathing threshold", () => {
    // Tight cadence: 0.1s gaps throughout.
    const m = computeAudioMetrics(steadyWords(20, { gap: 0.1 }), 8);
    expect(m.rushedFlag).toBe(true);
    expect(m.pauseEvents).toHaveLength(0);
  });

  it("does not set rushedFlag when the speaker takes breaths", () => {
    const words: Word[] = [
      { word: "one", start: 0, end: 0.5 },
      { word: "two", start: 1.5, end: 2.0 }, // 1.0s gap => breathing room
      { word: "three", start: 2.2, end: 2.6 },
    ];
    const m = computeAudioMetrics(words, 3);
    expect(m.rushedFlag).toBe(false);
  });

  it("does not set rushedFlag for a single word", () => {
    const m = computeAudioMetrics([{ word: "hi", start: 0, end: 0.4 }], 1);
    expect(m.rushedFlag).toBe(false);
  });
});
