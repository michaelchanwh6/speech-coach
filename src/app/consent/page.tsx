import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { acceptConsent } from "./actions";

export default async function ConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const existing = await prisma.user.findUnique({ where: { id: user.id } });
  if (existing?.consentAcceptedAt) {
    redirect("/record");
  }

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <h1 className="text-xl font-semibold">Before your first recording</h1>
        <p className="mt-1 text-sm text-gray-500">
          Quick heads-up on how your voice and video are handled.
        </p>
        <ul className="mt-4 list-disc space-y-3 pl-5 text-sm text-gray-700">
          <li>
            Your recording is sent to OpenAI to generate a transcript with
            word-level timing — that&apos;s how we measure pace, filler
            words, and pauses.
          </li>
          <li>
            If you record with your camera on, video of your face is
            analyzed on your own device to estimate how much you&apos;re
            facing the camera — the video itself is never sent to us or any
            third party for this analysis.
          </li>
          <li>
            We store the raw audio and video so you can review your session.
            You can delete any recording — and its stored media — at any time
            from its results page.
          </li>
        </ul>
        <form action={acceptConsent} className="mt-6">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            I understand, start recording
          </button>
        </form>
      </div>
    </main>
  );
}
