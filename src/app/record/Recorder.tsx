"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { createRecording } from "./actions";
import { analyzeCameraFacing } from "@/lib/cameraFacing";

const CONTEXTS = [
  { value: "conversational", label: "Conversational" },
  { value: "formal", label: "Formal presentation" },
  { value: "interview", label: "Interview" },
] as const;

type Context = (typeof CONTEXTS)[number]["value"];

const AUDIO_ONLY_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
];
const AUDIO_VIDEO_MIME_CANDIDATES = [
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
  | "uploading"
  | "transcribing"
  | "done"
  | "error";

export function Recorder({ userId }: { userId: string }) {
  const [context, setContext] = useState<Context>("formal");
  const [useVideo, setUseVideo] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [cameraFacingPct, setCameraFacingPct] = useState<number | null>(null);
  const [transcriptText, setTranscriptText] = useState<string | null>(null);

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

      const candidates = useVideo
        ? AUDIO_VIDEO_MIME_CANDIDATES
        : AUDIO_ONLY_MIME_CANDIDATES;
      const mimeType = pickMimeType(candidates);
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
        stream.getTracks().forEach((track) => track.stop());
        void handleFinish(mimeType);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      // eslint-disable-next-line react-hooks/purity -- runs only inside this event handler, never during render
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
      let cameraFacing: number | undefined;
      let gazeEvents: { start: number; end: number; facing: boolean }[] | undefined;

      if (useVideo) {
        setPhase("analyzing");
        const result = await analyzeCameraFacing(blob);
        cameraFacing = result.cameraFacingPct;
        gazeEvents = result.gazeEvents;
        setCameraFacingPct(result.cameraFacingPct);
      }

      setPhase("uploading");
      const extension = useVideo ? "webm" : mimeType.includes("mp4") ? "m4a" : "webm";
      const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`;

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("recordings")
        .upload(storagePath, blob, { contentType: mimeType });

      if (uploadError) throw uploadError;

      const { id } = await createRecording({
        storagePath,
        durationSec,
        context,
        hasVideo: useVideo,
        cameraFacingPct: cameraFacing,
        gazeEvents,
      });

      setPhase("transcribing");
      const res = await fetch(`/api/recordings/${id}/transcribe`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Transcription failed");
      setTranscriptText(body.text);

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
    setCameraFacingPct(null);
    setTranscriptText(null);
  }

  return (
    <div className="w-full max-w-sm text-center">
      {phase === "done" ? (
        <>
          <h1 className="text-xl font-semibold">Recording saved</h1>
          <p className="mt-1 text-sm text-gray-500">
            {Math.round(elapsedSec)}s, {CONTEXTS.find((c) => c.value === context)?.label}
          </p>
          {cameraFacingPct !== null && (
            <p className="mt-1 text-sm text-gray-500">
              Facing the camera {cameraFacingPct}% of the time
            </p>
          )}
          {transcriptText && (
            <p className="mt-4 rounded-md bg-gray-100 p-3 text-left text-sm text-gray-700">
              {transcriptText}
            </p>
          )}
          <button
            onClick={reset}
            className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-medium text-white"
          >
            Record another
          </button>
        </>
      ) : (
        <>
          <h1 className="text-xl font-semibold">Record a speech</h1>

          <label className="mt-6 block text-left text-sm font-medium">
            Speaking context
          </label>
          <select
            value={context}
            onChange={(e) => setContext(e.target.value as Context)}
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
            Also record video (beta) — analyzes camera-facing time on your
            device only
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
              <p className="text-sm text-gray-500">
                Analyzing video on your device…
              </p>
            )}
            {phase === "uploading" && (
              <p className="text-sm text-gray-500">Saving your recording…</p>
            )}
            {phase === "transcribing" && (
              <p className="text-sm text-gray-500">Transcribing…</p>
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
        </>
      )}
    </div>
  );
}
