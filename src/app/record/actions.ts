"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

type RecordingContext = "conversational" | "formal" | "interview";

export async function createRecording(input: {
  storagePath: string;
  durationSec: number;
  context: RecordingContext;
  hasVideo: boolean;
  cameraFacingPct?: number;
  smilePct?: number;
  handsVisiblePct?: number;
  gestureActivity?: number;
  gazeEvents?: { start: number; end: number; facing: boolean }[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const recording = await prisma.recording.create({
    data: {
      userId: user.id,
      audioUrl: input.storagePath,
      hasVideo: input.hasVideo,
      durationSec: input.durationSec,
      context: input.context,
      status: "uploaded",
    },
  });

  if (input.hasVideo && input.cameraFacingPct !== undefined) {
    await prisma.metrics.create({
      data: {
        recordingId: recording.id,
        cameraFacingPct: input.cameraFacingPct,
        smilePct: input.smilePct,
        handsVisiblePct: input.handsVisiblePct,
        gestureActivity: input.gestureActivity,
        gazeEvents: input.gazeEvents ?? [],
      },
    });
  }

  return { id: recording.id };
}
