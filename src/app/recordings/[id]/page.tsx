import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import {
  WPM_TARGETS,
  type RecordingContext,
  type FillerEvent,
  type PauseEvent,
} from "@/lib/analysis/audioMetrics";
import { DeleteButton } from "./DeleteButton";

const CONTEXT_LABELS: Record<RecordingContext, string> = {
  conversational: "Conversational",
  formal: "Formal presentation",
  interview: "Interview",
};

type CoachFeedback = {
  summary: string;
  strengths: string[];
  focusAreas: string[];
};

function gestureLabel(activity: number): string {
  if (activity < 0.33) return "Reserved";
  if (activity < 0.66) return "Moderate";
  return "Animated";
}

function paceNote(wpm: number, ctx: RecordingContext): string {
  const { min, max } = WPM_TARGETS[ctx];
  if (wpm < min) return `Below the ${min}–${max} target — room to pick up energy`;
  if (wpm > max) return `Above the ${min}–${max} target — try slowing down`;
  return `Right in the ${min}–${max} target range`;
}

function MetricCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 text-left">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-gray-500">{note}</p>}
    </div>
  );
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const recording = await prisma.recording.findUnique({
    where: { id },
    include: { transcript: true, metrics: true, feedback: true },
  });
  if (!recording || recording.userId !== user.id) notFound();

  const ctx = recording.context as RecordingContext;
  const metrics = recording.metrics;
  const feedback = recording.feedback?.items as CoachFeedback | undefined;
  const fillerEvents = (metrics?.fillerEvents as FillerEvent[] | null) ?? [];
  const fillerExamples = [...new Set(fillerEvents.map((f) => f.word))].slice(0, 4);
  const pauseEvents = (metrics?.pauseEvents as PauseEvent[] | null) ?? [];
  const awkwardPauses = pauseEvents.filter((p) => p.flag === "awkward").length;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Your session</h1>
          <p className="mt-1 text-sm text-gray-500">
            {Math.round(recording.durationSec)}s · {CONTEXT_LABELS[ctx]} ·{" "}
            {recording.createdAt.toLocaleDateString()}
          </p>
        </div>
        <Link
          href="/record"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
        >
          Record another
        </Link>
      </div>

      {/* Coaching feedback */}
      {feedback ? (
        <section className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
          <p className="text-base">{feedback.summary}</p>
          {feedback.strengths.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                What worked
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {feedback.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {feedback.focusAreas.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                Focus next time
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                {feedback.focusAreas.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <p className="mt-6 rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
          {recording.status === "failed"
            ? "We couldn't process this recording. Try recording again."
            : "Coaching feedback isn't available for this session, but your metrics are below."}
        </p>
      )}

      {/* Metric cards */}
      <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {metrics?.wpmAvg != null && (
          <MetricCard
            label="Pace"
            value={`${metrics.wpmAvg} WPM`}
            note={paceNote(metrics.wpmAvg, ctx)}
          />
        )}
        {metrics?.fillerCount != null && (
          <MetricCard
            label="Filler words"
            value={`${metrics.fillerCount}`}
            note={
              fillerExamples.length ? fillerExamples.join(", ") : "None caught"
            }
          />
        )}
        {metrics?.pauseEvents != null && (
          <MetricCard
            label="Awkward pauses"
            value={`${awkwardPauses}`}
            note={
              metrics.rushedFlag
                ? "Delivery felt rushed — little breathing room"
                : "Pauses over 2.5s"
            }
          />
        )}
        {metrics?.cameraFacingPct != null && (
          <MetricCard
            label="Facing camera"
            value={`${metrics.cameraFacingPct}%`}
            note="Of the time"
          />
        )}
        {metrics?.smilePct != null && (
          <MetricCard
            label="Positive expression"
            value={`${metrics.smilePct}%`}
            note="Smiling / warm"
          />
        )}
        {metrics?.gestureActivity != null && (
          <MetricCard
            label="Gestures"
            value={gestureLabel(metrics.gestureActivity)}
            note={
              metrics.handsVisiblePct != null
                ? `Hands visible ${metrics.handsVisiblePct}% of the time`
                : undefined
            }
          />
        )}
      </section>

      {/* Transcript */}
      {recording.transcript?.fullText && (
        <details className="mt-6 rounded-lg border border-gray-200 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Transcript
          </summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
            {recording.transcript.fullText}
          </p>
        </details>
      )}

      <div className="mt-8 border-t border-gray-200 pt-4">
        <DeleteButton id={recording.id} />
      </div>
    </main>
  );
}
