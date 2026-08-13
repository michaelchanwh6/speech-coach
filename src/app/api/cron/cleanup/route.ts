import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { createAdminClient } from "@/lib/supabase/admin";

// Retention cleanup: deletes the stored media for recordings past their
// audioExpiresAt, while keeping the transcript + metrics rows for progress
// (per the retention policy in the consent screen). Runs daily via Vercel Cron.
//
// Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when the
// env var is set; we reject anything else so the route can't be triggered by
// the public.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await prisma.recording.findMany({
    where: {
      audioExpiresAt: { lt: new Date() },
      audioUrl: { not: null },
    },
    select: { id: true, audioUrl: true },
  });

  const supabase = createAdminClient();
  let deleted = 0;

  for (const rec of expired) {
    if (!rec.audioUrl) continue;
    const { error } = await supabase.storage
      .from("recordings")
      .remove([rec.audioUrl]);
    if (error) {
      console.error(`Cleanup failed for recording ${rec.id}:`, error.message);
      continue;
    }
    await prisma.recording.update({
      where: { id: rec.id },
      data: { audioUrl: null },
    });
    deleted += 1;
  }

  return NextResponse.json({ ok: true, deleted, scanned: expired.length });
}
