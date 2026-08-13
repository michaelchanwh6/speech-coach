import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

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

    const words = (transcription.words ?? []).map((w) => ({
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

    await prisma.recording.update({ where: { id }, data: { status: "done" } });

    return NextResponse.json({ ok: true, text: transcription.text });
  } catch (e) {
    await prisma.recording.update({
      where: { id },
      data: { status: "failed" },
    });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
