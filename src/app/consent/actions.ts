"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";

export async function acceptConsent() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  await prisma.user.upsert({
    where: { id: user.id },
    create: { id: user.id, consentAcceptedAt: new Date() },
    update: { consentAcceptedAt: new Date() },
  });

  redirect("/record");
}
