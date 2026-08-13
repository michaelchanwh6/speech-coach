import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { Recorder } from "./Recorder";

export default async function RecordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
  if (!dbUser?.consentAcceptedAt) {
    redirect("/consent");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Recorder userId={user.id} />
    </main>
  );
}
