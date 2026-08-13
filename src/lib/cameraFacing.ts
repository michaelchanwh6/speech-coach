import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// Landmark indices from MediaPipe's 468-point face mesh topology — the same
// six points (nose tip, chin, eye corners, mouth corners) used in most
// MediaPipe head-pose sample code. We only need nose tip + eye corners here.
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 263;
const RIGHT_EYE_OUTER = 33;

const SAMPLE_INTERVAL_MS = 300;
// Below this left/right symmetry ratio, the head is turned enough that we
// don't count it as camera-facing. Not true gaze tracking — a head-pose
// proxy only.
const FACING_SYMMETRY_THRESHOLD = 0.6;

let landmarkerPromise: Promise<FaceLandmarker> | null = null;

function getLandmarker() {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
      );
      return FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
        },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    })();
  }
  return landmarkerPromise;
}

function isFacingCamera(landmarks: { x: number }[]) {
  const nose = landmarks[NOSE_TIP];
  const left = landmarks[LEFT_EYE_OUTER];
  const right = landmarks[RIGHT_EYE_OUTER];
  const distLeft = Math.abs(nose.x - left.x);
  const distRight = Math.abs(nose.x - right.x);
  const ratio = Math.min(distLeft, distRight) / Math.max(distLeft, distRight);
  return ratio > FACING_SYMMETRY_THRESHOLD;
}

export type GazeEvent = { start: number; end: number; facing: boolean };

export async function analyzeCameraFacing(
  blob: Blob
): Promise<{ cameraFacingPct: number; gazeEvents: GazeEvent[] }> {
  const landmarker = await getLandmarker();

  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  const objectUrl = URL.createObjectURL(blob);
  video.src = objectUrl;

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(new Error("Couldn't load recorded video for analysis"));
    });

    const durationMs = video.duration * 1000;
    const samples: { t: number; facing: boolean }[] = [];

    for (let t = 0; t < durationMs; t += SAMPLE_INTERVAL_MS) {
      await new Promise<void>((resolve) => {
        video.currentTime = t / 1000;
        video.onseeked = () => resolve();
      });
      const result = landmarker.detectForVideo(video, t);
      const facing = result.faceLandmarks[0]
        ? isFacingCamera(result.faceLandmarks[0])
        : false;
      samples.push({ t, facing });
    }

    const facingCount = samples.filter((s) => s.facing).length;
    const cameraFacingPct = samples.length
      ? Math.round((facingCount / samples.length) * 100)
      : 0;

    const gazeEvents: GazeEvent[] = [];
    for (const sample of samples) {
      const startSec = sample.t / 1000;
      const endSec = startSec + SAMPLE_INTERVAL_MS / 1000;
      const last = gazeEvents[gazeEvents.length - 1];
      if (last && last.facing === sample.facing) {
        last.end = endSec;
      } else {
        gazeEvents.push({ start: startSec, end: endSec, facing: sample.facing });
      }
    }

    return { cameraFacingPct, gazeEvents };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
