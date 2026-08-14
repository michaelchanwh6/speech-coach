import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import {
  computeAudioMetrics,
  type Word,
  type RecordingContext,
} from "@/lib/analysis/audioMetrics";
import { generateFeedback } from "@/lib/analysis/feedback";

// Stateless demo pipeline: receive the recorded audio, transcribe it, compute
// pace/filler/pause metrics, and generate coaching feedback. Nothing is stored —
// the audio is processed in-memory and discarded when the request ends.

const CONTEXTS = new Set(["conversational", "formal", "interview"]);

type Vision = {
  cameraFacingPct?: number | null;
  smilePct?: number | null;
  handsVisiblePct?: number | null;
  gestureActivity?: number | null;
};

export async function POST(request: Request) {
  const form = await request.formData();
  const audio = form.get("audio");
  const contextRaw = String(form.get("context") ?? "formal");
  const durationSec = Number(form.get("durationSec") ?? 0);

  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }
  const context = (CONTEXTS.has(contextRaw) ? contextRaw : "formal") as RecordingContext;

  let vision: Vision = {};
  const visionRaw = form.get("vision");
  if (typeof visionRaw === "string" && visionRaw) {
    try {
      vision = JSON.parse(visionRaw);
    } catch {
      // Ignore malformed vision payloads — audio metrics still work.
    }
  }

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const file = await toFile(audio, "speech.webm");

    const transcription = await openai.audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    });

    const words: Word[] = (transcription.words ?? []).map((w) => ({
      word: w.word,
      start: w.start,
      end: w.end,
    }));

    const metrics = computeAudioMetrics(words, durationSec);
    const fillerExamples = [
      ...new Set(metrics.fillerEvents.map((f) => f.word)),
    ].slice(0, 4);
    const awkwardPauseCount = metrics.pauseEvents.filter(
      (p) => p.flag === "awkward"
    ).length;

    // Coaching feedback is best-effort — if it fails, the metrics still return.
    let feedback = null;
    try {
      feedback = await generateFeedback({
        context,
        durationSec,
        transcript: transcription.text,
        wpmAvg: metrics.wpmAvg,
        fillerCount: metrics.fillerCount,
        fillerExamples,
        awkwardPauseCount,
        rushedFlag: metrics.rushedFlag,
        cameraFacingPct: vision.cameraFacingPct,
        smilePct: vision.smilePct,
        handsVisiblePct: vision.handsVisiblePct,
        gestureActivity: vision.gestureActivity,
      });
    } catch (feedbackError) {
      console.error("Feedback generation failed:", feedbackError);
    }

    return NextResponse.json({
      transcript: transcription.text,
      context,
      metrics: {
        wpmAvg: metrics.wpmAvg,
        fillerCount: metrics.fillerCount,
        fillerExamples,
        awkwardPauseCount,
        rushedFlag: metrics.rushedFlag,
      },
      feedback,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
