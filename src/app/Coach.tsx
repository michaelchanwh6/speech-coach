"use client";

import { useRef, useState } from "react";
import { analyzeVideo, type VideoAnalysis } from "@/lib/vision/analyzeVideo";
import { WPM_TARGETS, type RecordingContext } from "@/lib/analysis/audioMetrics";

const CONTEXTS = [
  { value: "conversational", label: "Conversational", short: "Casual" },
  { value: "formal", label: "Formal presentation", short: "Formal" },
  { value: "interview", label: "Interview", short: "Interview" },
] as const;

const CONTEXT_LABELS: Record<RecordingContext, string> = {
  conversational: "Conversational",
  formal: "Formal presentation",
  interview: "Interview",
};

const AUDIO_ONLY_MIME = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
const AUDIO_VIDEO_MIME = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

function pickMimeType(candidates: string[]) {
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

type Phase =
  | "idle"
  | "recording"
  | "analyzing"
  | "transcribing"
  | "done"
  | "error";

type AnalyzeResult = {
  transcript: string;
  context: RecordingContext;
  metrics: {
    wpmAvg: number;
    fillerCount: number;
    fillerExamples: string[];
    awkwardPauseCount: number;
    rushedFlag: boolean;
  };
  feedback: { summary: string; strengths: string[]; focusAreas: string[] } | null;
};

type Tone = "good" | "warn" | "neutral";

function gestureLabel(activity: number): string {
  if (activity < 0.33) return "Reserved";
  if (activity < 0.66) return "Moderate";
  return "Animated";
}

function paceNote(wpm: number, ctx: RecordingContext): string {
  const { min, max } = WPM_TARGETS[ctx];
  if (wpm < min) return `Below the ${min}–${max} target range`;
  if (wpm > max) return `Above the ${min}–${max} target range`;
  return `Inside the ${min}–${max} target range`;
}

function paceStatus(wpm: number, ctx: RecordingContext): { text: string; tone: Tone } {
  const { min, max } = WPM_TARGETS[ctx];
  if (wpm < min) return { text: "Slow", tone: "warn" };
  if (wpm > max) return { text: "Fast", tone: "warn" };
  return { text: "On target", tone: "good" };
}

// ---- small presentational pieces ----

function StatPill({ text, tone }: { text: string; tone: Tone }) {
  const cls =
    tone === "good"
      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
        : "bg-surface-2 text-muted";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {text}
    </span>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
  pill,
  bar,
}: {
  label: string;
  value: string;
  note?: string;
  pill?: { text: string; tone: Tone };
  bar?: number;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          {label}
        </p>
        {pill && <StatPill text={pill.text} tone={pill.tone} />}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </p>
      {bar !== undefined && <Bar value={bar} />}
      {note && <p className="mt-1.5 text-xs text-muted">{note}</p>}
    </div>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-surface-2 border border-line"
      } ${disabled ? "opacity-50" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Spinner() {
  return (
    <span className="h-7 w-7 animate-spin rounded-full border-2 border-line border-t-accent" />
  );
}

export function Coach() {
  const [context, setContext] = useState<RecordingContext>("formal");
  const [useVideo, setUseVideo] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [vision, setVision] = useState<VideoAnalysis | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startTimeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  async function startRecording() {
    setErrorMessage("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: useVideo,
      });
      if (useVideo && previewRef.current) {
        previewRef.current.srcObject = stream;
      }

      const mimeType = pickMimeType(useVideo ? AUDIO_VIDEO_MIME : AUDIO_ONLY_MIME);
      if (!mimeType) {
        setPhase("error");
        setErrorMessage("This browser doesn't support recording that way.");
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void handleFinish(mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      // eslint-disable-next-line react-hooks/purity -- event handler, not render
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 250);
      setPhase("recording");
    } catch {
      setPhase("error");
      setErrorMessage(
        "Couldn't access your microphone/camera — check permissions and try again."
      );
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  async function handleFinish(mimeType: string) {
    const durationSec = (Date.now() - startTimeRef.current) / 1000;
    const blob = new Blob(chunksRef.current, { type: mimeType });

    try {
      let visionResult: VideoAnalysis | undefined;
      if (useVideo) {
        setPhase("analyzing");
        visionResult = await analyzeVideo(blob);
        setVision(visionResult);
      }

      setPhase("transcribing");
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      form.append("context", context);
      form.append("durationSec", String(durationSec));
      if (visionResult) {
        form.append(
          "vision",
          JSON.stringify({
            cameraFacingPct: visionResult.cameraFacingPct,
            smilePct: visionResult.smilePct,
            handsVisiblePct: visionResult.handsVisiblePct,
            gestureActivity: visionResult.gestureActivity,
          })
        );
      }

      const res = await fetch("/api/analyze", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Analysis failed");

      setResult(body as AnalyzeResult);
      setPhase("done");
    } catch (e) {
      setPhase("error");
      setErrorMessage(
        e instanceof Error ? e.message : "Something went wrong — try again."
      );
    }
  }

  function reset() {
    setPhase("idle");
    setElapsedSec(0);
    setErrorMessage("");
    setResult(null);
    setVision(null);
  }

  const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const ss = String(elapsedSec % 60).padStart(2, "0");

  // ---- Results view ----
  if (phase === "done" && result) {
    const m = result.metrics;
    const pace = paceStatus(m.wpmAvg, result.context);
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Your session</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                {Math.round(elapsedSec)}s
              </span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                {CONTEXT_LABELS[result.context]}
              </span>
              {vision && (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted">
                  video
                </span>
              )}
            </div>
          </div>
          <button
            onClick={reset}
            className="rounded-full bg-gradient-to-r from-accent to-accent-2 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-110 active:scale-[.99]"
          >
            Record another
          </button>
        </div>

        {result.feedback ? (
          <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="border-b border-line bg-gradient-to-br from-accent/[0.08] to-accent-2/[0.08] px-5 py-5 sm:px-6">
              <div className="flex items-center gap-2 text-accent">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" />
                </svg>
                <span className="text-xs font-semibold uppercase tracking-wider">
                  Your coaching
                </span>
              </div>
              <p className="mt-2.5 text-[15px] leading-relaxed sm:text-base">
                {result.feedback.summary}
              </p>
            </div>
            <div className="grid gap-6 p-5 sm:grid-cols-2 sm:px-6">
              {result.feedback.strengths.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    What worked
                  </p>
                  <ul className="mt-2.5 space-y-2 text-sm text-fg/90">
                    {result.feedback.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.feedback.focusAreas.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Focus next time
                  </p>
                  <ul className="mt-2.5 space-y-2 text-sm text-fg/90">
                    {result.feedback.focusAreas.map((f, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                        <span className="leading-relaxed">{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        ) : (
          <p className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm text-muted">
            Couldn&apos;t generate coaching feedback this time, but your metrics
            are below.
          </p>
        )}

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Pace"
            value={`${m.wpmAvg} WPM`}
            note={paceNote(m.wpmAvg, result.context)}
            pill={pace}
          />
          <MetricCard
            label="Filler words"
            value={`${m.fillerCount}`}
            note={m.fillerExamples.length ? m.fillerExamples.join(", ") : "None caught"}
            pill={
              m.fillerCount === 0
                ? { text: "Clean", tone: "good" }
                : m.fillerCount >= 6
                  ? { text: "High", tone: "warn" }
                  : undefined
            }
          />
          <MetricCard
            label="Awkward pauses"
            value={`${m.awkwardPauseCount}`}
            note={m.rushedFlag ? "Delivery felt rushed" : "Pauses over 2.5s"}
            pill={
              m.rushedFlag
                ? { text: "Rushed", tone: "warn" }
                : m.awkwardPauseCount === 0
                  ? { text: "Smooth", tone: "good" }
                  : undefined
            }
          />
          {vision && (
            <>
              <MetricCard
                label="Facing camera"
                value={`${vision.cameraFacingPct}%`}
                bar={vision.cameraFacingPct}
                note="Of the time"
              />
              <MetricCard
                label="Positive expression"
                value={`${vision.smilePct}%`}
                bar={vision.smilePct}
                note="Smiling / warm"
              />
              <MetricCard
                label="Gestures"
                value={gestureLabel(vision.gestureActivity)}
                note={`Hands visible ${vision.handsVisiblePct}% of the time`}
              />
            </>
          )}
        </section>

        {result.transcript && (
          <details className="group mt-4 rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium [&::-webkit-details-marker]:hidden">
              Transcript
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted transition-transform group-open:rotate-180"
                aria-hidden
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted">
              {result.transcript}
            </p>
          </details>
        )}
      </div>
    );
  }

  // ---- Setup / recording view ----
  return (
    <div className="w-full max-w-md">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
          Practice your speech
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
          Record a take and get instant, specific coaching on your delivery.
        </p>
      </div>

      <div className="mt-7 rounded-3xl border border-line bg-surface p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">
          Speaking context
        </p>
        <div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-2 p-1">
          {CONTEXTS.map((c) => (
            <button
              key={c.value}
              onClick={() => setContext(c.value)}
              disabled={phase !== "idle"}
              className={`rounded-lg px-2 py-2 text-xs font-medium transition ${
                context === c.value
                  ? "bg-surface text-fg shadow-sm"
                  : "text-muted hover:text-fg"
              } ${phase !== "idle" ? "cursor-default opacity-60" : ""}`}
            >
              {c.short}
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3">
          <span className="text-left">
            <span className="block text-sm font-medium">Record video</span>
            <span className="block text-xs text-muted">
              Analyzes expression &amp; gestures on-device
            </span>
          </span>
          <Switch
            checked={useVideo}
            onChange={setUseVideo}
            disabled={phase !== "idle"}
          />
        </div>

        {useVideo && (
          <div className="relative mt-4 aspect-video overflow-hidden rounded-2xl bg-black ring-1 ring-line">
            <video
              ref={previewRef}
              autoPlay
              muted
              playsInline
              className="h-full w-full object-cover"
            />
            {phase === "recording" && (
              <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                <span className="h-2 w-2 rounded-full bg-red-500" />
                REC
              </span>
            )}
          </div>
        )}

        <div className="mt-6">
          {phase === "idle" && (
            <button
              onClick={startRecording}
              className="flex w-full items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-accent to-accent-2 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-accent/25 transition hover:brightness-110 active:scale-[.99]"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-white/95" />
              Start recording
            </button>
          )}

          {phase === "recording" && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 text-sm font-medium text-muted">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                </span>
                Recording
              </div>
              <p className="font-mono text-5xl font-semibold tabular-nums tracking-tight">
                {mm}:{ss}
              </p>
              <button
                onClick={stopRecording}
                className="flex items-center gap-2 rounded-full bg-fg px-6 py-3 text-sm font-semibold text-bg transition hover:opacity-90 active:scale-[.99]"
              >
                <span className="h-2.5 w-2.5 rounded-sm bg-current" />
                Stop
              </button>
            </div>
          )}

          {(phase === "analyzing" || phase === "transcribing") && (
            <div className="flex flex-col items-center gap-3 py-2">
              <Spinner />
              <p className="text-sm text-muted">
                {phase === "analyzing"
                  ? "Analyzing video on your device…"
                  : "Transcribing & coaching your delivery…"}
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="rounded-xl border border-red-500/25 bg-red-500/[0.08] p-3.5 text-center">
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                {errorMessage}
              </p>
              <button
                onClick={reset}
                className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-medium transition hover:bg-surface-2"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-muted">
        Best in Chrome, Edge, or Firefox.
      </p>
    </div>
  );
}
