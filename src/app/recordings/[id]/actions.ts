"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

// Hard-delete a recording: removes the stored media file and cascades the
// DB rows (transcript, metrics, feedback via onDelete: Cascade). This is the
// real deletion the consent screen promises, not a soft flag.
export async function deleteRecording(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const recording = await prisma.recording.findUnique({ where: { id } });
  if (!recording || recording.userId !== user.id) {
    // Nothing to delete / not the owner — send them home either way.
    redirect("/record");
  }

  if (recording.audioUrl) {
    await supabase.storage.from("recordings").remove([recording.audioUrl]);
  }
  await prisma.recording.delete({ where: { id } });

  redirect("/record");
}
