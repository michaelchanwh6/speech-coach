"use client";

import { useRef, useState } from "react";
import { analyzeVideo, type VideoAnalysis } from "@/lib/vision/analyzeVideo";
import { WPM_TARGETS, type RecordingContext } from "@/lib/analysis/audioMetrics";

const CONTEXTS = [
  { value: "conversational", label: "Conversational" },
  { value: "formal", label: "Formal presentation" },
  { value: "interview", label: "Interview" },
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

  // ---- Results view ----
  if (phase === "done" && result) {
    const m = result.metrics;
    return (
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Your session</h1>
            <p className="mt-1 text-sm text-gray-500">
              {Math.round(elapsedSec)}s · {CONTEXT_LABELS[result.context]}
            </p>
          </div>
          <button
            onClick={reset}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Record another
          </button>
        </div>

        {result.feedback ? (
          <section className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-5">
            <p className="text-base">{result.feedback.summary}</p>
            {result.feedback.strengths.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  What worked
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {result.feedback.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.feedback.focusAreas.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                  Focus next time
                </p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {result.feedback.focusAreas.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        ) : (
          <p className="mt-6 rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
            Couldn&apos;t generate coaching feedback this time, but your metrics
            are below.
          </p>
        )}

        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <MetricCard
            label="Pace"
            value={`${m.wpmAvg} WPM`}
            note={paceNote(m.wpmAvg, result.context)}
          />
          <MetricCard
            label="Filler words"
            value={`${m.fillerCount}`}
            note={m.fillerExamples.length ? m.fillerExamples.join(", ") : "None caught"}
          />
          <MetricCard
            label="Awkward pauses"
            value={`${m.awkwardPauseCount}`}
            note={
              m.rushedFlag ? "Delivery felt rushed" : "Pauses over 2.5s"
            }
          />
          {vision && (
            <>
              <MetricCard
                label="Facing camera"
                value={`${vision.cameraFacingPct}%`}
                note="Of the time"
              />
              <MetricCard
                label="Positive expression"
                value={`${vision.smilePct}%`}
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
          <details className="mt-6 rounded-lg border border-gray-200 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Transcript
            </summary>
            <p className="mt-3 whitespace-pre-wrap text-sm text-gray-700">
              {result.transcript}
            </p>
          </details>
        )}
      </div>
    );
  }

  // ---- Recording / setup view ----
  return (
    <div className="w-full max-w-sm text-center">
      <h1 className="text-xl font-semibold">Practice your speech</h1>
      <p className="mt-1 text-sm text-gray-500">
        Record, and get instant coaching on your delivery.
      </p>

      <label className="mt-6 block text-left text-sm font-medium">
        Speaking context
      </label>
      <select
        value={context}
        onChange={(e) => setContext(e.target.value as RecordingContext)}
        disabled={phase !== "idle"}
        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-50"
      >
        {CONTEXTS.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <label className="mt-4 flex items-center gap-2 text-left text-sm">
        <input
          type="checkbox"
          checked={useVideo}
          onChange={(e) => setUseVideo(e.target.checked)}
          disabled={phase !== "idle"}
        />
        Record video too — analyzes expression &amp; gestures on your device
      </label>

      {useVideo && (
        <video
          ref={previewRef}
          autoPlay
          muted
          playsInline
          className="mt-4 aspect-video w-full rounded-md bg-black"
        />
      )}

      <div className="mt-8">
        {phase === "recording" && (
          <p className="mb-3 text-2xl font-mono tabular-nums">
            {String(Math.floor(elapsedSec / 60)).padStart(2, "0")}:
            {String(elapsedSec % 60).padStart(2, "0")}
          </p>
        )}

        {phase === "idle" && (
          <button
            onClick={startRecording}
            className="rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white"
          >
            ● Start recording
          </button>
        )}
        {phase === "recording" && (
          <button
            onClick={stopRecording}
            className="rounded-full bg-black px-6 py-3 text-sm font-medium text-white"
          >
            ■ Stop
          </button>
        )}
        {phase === "analyzing" && (
          <p className="text-sm text-gray-500">Analyzing video on your device…</p>
        )}
        {phase === "transcribing" && (
          <p className="text-sm text-gray-500">
            Transcribing and coaching your delivery…
          </p>
        )}
        {phase === "error" && (
          <div>
            <p className="text-sm text-red-600">{errorMessage}</p>
            <button
              onClick={reset}
              className="mt-4 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
