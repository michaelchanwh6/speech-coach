import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  computeAudioMetrics,
  type Word,
  type RecordingContext,
} from "@/lib/analysis/audioMetrics";
import { generateFeedback } from "@/lib/analysis/feedback";

// Full post-recording pipeline: transcribe -> compute audio metrics -> generate
// coaching feedback. Vision metrics (if any) were already written at create
// time, so by the time this runs the Metrics row may already hold them.
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || recording.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.recording.update({
    where: { id },
    data: { status: "processing" },
  });

  try {
    const { data: audioBlob, error: downloadError } = await supabase.storage
      .from("recordings")
      .download(recording.audioUrl);
    if (downloadError || !audioBlob) {
      throw new Error(downloadError?.message ?? "Couldn't download audio");
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const filename = recording.audioUrl.split("/").pop() ?? "audio.webm";
    const file = await toFile(audioBlob, filename);

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

    await prisma.transcript.upsert({
      where: { recordingId: id },
      create: {
        recordingId: id,
        fullText: transcription.text,
        language: transcription.language ?? null,
        words,
      },
      update: {
        fullText: transcription.text,
        language: transcription.language ?? null,
        words,
      },
    });

    // Compute audio metrics and merge them into the Metrics row without
    // clobbering any vision fields written at create time.
    const audio = computeAudioMetrics(words, recording.durationSec);
    const metrics = await prisma.metrics.upsert({
      where: { recordingId: id },
      create: {
        recordingId: id,
        wpmAvg: audio.wpmAvg,
        wpmWindowed: audio.wpmWindowed,
        fillerCount: audio.fillerCount,
        fillerEvents: audio.fillerEvents,
        pauseEvents: audio.pauseEvents,
        rushedFlag: audio.rushedFlag,
      },
      update: {
        wpmAvg: audio.wpmAvg,
        wpmWindowed: audio.wpmWindowed,
        fillerCount: audio.fillerCount,
        fillerEvents: audio.fillerEvents,
        pauseEvents: audio.pauseEvents,
        rushedFlag: audio.rushedFlag,
      },
    });

    // Coaching feedback is best-effort: if the LLM call fails, the recording
    // still completes with metrics saved and the results page degrades.
    try {
      const feedback = await generateFeedback({
        context: recording.context as RecordingContext,
        durationSec: recording.durationSec,
        transcript: transcription.text,
        wpmAvg: audio.wpmAvg,
        fillerCount: audio.fillerCount,
        fillerExamples: [...new Set(audio.fillerEvents.map((f) => f.word))].slice(
          0,
          4
        ),
        awkwardPauseCount: audio.pauseEvents.filter((p) => p.flag === "awkward")
          .length,
        rushedFlag: audio.rushedFlag,
        cameraFacingPct: metrics.cameraFacingPct,
        smilePct: metrics.smilePct,
        handsVisiblePct: metrics.handsVisiblePct,
        gestureActivity: metrics.gestureActivity,
      });
      await prisma.feedback.upsert({
        where: { recordingId: id },
        create: { recordingId: id, items: feedback },
        update: { items: feedback },
      });
    } catch (feedbackError) {
      console.error("Feedback generation failed:", feedbackError);
    }

    await prisma.recording.update({ where: { id }, data: { status: "done" } });

    return NextResponse.json({ ok: true, id });
  } catch (e) {
    await prisma.recording.update({
      where: { id },
      data: { status: "failed" },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Processing failed" },
      { status: 500 }
    );
  }
}
