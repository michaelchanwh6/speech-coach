import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
  type Category,
} from "@mediapipe/tasks-vision";

// On-device video analysis. Everything here runs in the browser against the
// recorded blob — the video is never uploaded for this, matching the consent
// copy. Produces three headline signals plus a camera-facing timeline.

// Face-mesh landmark indices (MediaPipe 468-point topology).
const NOSE_TIP = 1;
const LEFT_EYE_OUTER = 263;
const RIGHT_EYE_OUTER = 33;
// Hand landmark index for the wrist (used to measure gesture movement).
const WRIST = 0;

const SAMPLE_INTERVAL_MS = 300;
// Below this left/right symmetry ratio the head is turned away — a head-pose
// proxy, not true gaze tracking.
const FACING_SYMMETRY_THRESHOLD = 0.6;
// Mean of the two smile blendshapes above this counts as "smiling".
const SMILE_THRESHOLD = 0.3;
// Per-frame wrist movement (normalized units) that maps to full activity.
// ~0.08 of the frame width between 300ms samples reads as animated gesturing.
const GESTURE_FULL_SCALE = 0.08;

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

let landmarkersPromise: Promise<{
  face: FaceLandmarker;
  hand: HandLandmarker;
}> | null = null;

// The landmarkers are reused across recordings, and in VIDEO mode they require
// strictly increasing timestamps for their entire lifetime. Real video time
// restarts at 0 each recording, which the detectors reject — so we feed them a
// monotonic counter that only ever moves forward.
let detectTimestamp = 0;

function getLandmarkers() {
  if (!landmarkersPromise) {
    landmarkersPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      const [face, hand] = await Promise.all([
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
        }),
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: HAND_MODEL_URL },
          runningMode: "VIDEO",
          numHands: 2,
        }),
      ]);
      return { face, hand };
    })();
  }
  return landmarkersPromise;
}

function isFacingCamera(landmarks: { x: number }[]): boolean {
  const nose = landmarks[NOSE_TIP];
  const left = landmarks[LEFT_EYE_OUTER];
  const right = landmarks[RIGHT_EYE_OUTER];
  const distLeft = Math.abs(nose.x - left.x);
  const distRight = Math.abs(nose.x - right.x);
  const ratio = Math.min(distLeft, distRight) / Math.max(distLeft, distRight);
  return ratio > FACING_SYMMETRY_THRESHOLD;
}

function isSmiling(blendshapes: Category[]): boolean {
  let left = 0;
  let right = 0;
  for (const c of blendshapes) {
    if (c.categoryName === "mouthSmileLeft") left = c.score;
    else if (c.categoryName === "mouthSmileRight") right = c.score;
  }
  return (left + right) / 2 > SMILE_THRESHOLD;
}

export type GazeEvent = { start: number; end: number; facing: boolean };

export type VideoAnalysis = {
  cameraFacingPct: number;
  smilePct: number;
  handsVisiblePct: number;
  gestureActivity: number; // 0-1
  gazeEvents: GazeEvent[];
};

type Sample = {
  t: number;
  facing: boolean;
  smiling: boolean;
  handsVisible: boolean;
  wrist: NormalizedLandmark | null;
};

function pct(count: number, total: number): number {
  return total ? Math.round((count / total) * 100) : 0;
}

export async function analyzeVideo(blob: Blob): Promise<VideoAnalysis> {
  const { face, hand } = await getLandmarkers();

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
    const samples: Sample[] = [];

    for (let t = 0; t < durationMs; t += SAMPLE_INTERVAL_MS) {
      await new Promise<void>((resolve) => {
        video.currentTime = t / 1000;
        video.onseeked = () => resolve();
      });

      // Monotonic timestamp for the detectors (must always increase across the
      // singleton's lifetime); `t` is still used for seeking + event timing.
      detectTimestamp += SAMPLE_INTERVAL_MS;
      const faceResult = face.detectForVideo(video, detectTimestamp);
      const handResult = hand.detectForVideo(video, detectTimestamp);

      const faceLandmarks = faceResult.faceLandmarks[0];
      const blendshapes = faceResult.faceBlendshapes[0]?.categories ?? [];
      const handLandmarks = handResult.landmarks[0];

      samples.push({
        t,
        facing: faceLandmarks ? isFacingCamera(faceLandmarks) : false,
        smiling: faceLandmarks ? isSmiling(blendshapes) : false,
        handsVisible: !!handLandmarks,
        wrist: handLandmarks ? handLandmarks[WRIST] : null,
      });
    }

    const total = samples.length;
    const cameraFacingPct = pct(
      samples.filter((s) => s.facing).length,
      total
    );
    const smilePct = pct(samples.filter((s) => s.smiling).length, total);
    const handsVisiblePct = pct(
      samples.filter((s) => s.handsVisible).length,
      total
    );

    // Gesture activity: mean wrist displacement across consecutive frames where
    // a hand is visible in both, scaled to 0-1.
    let movementSum = 0;
    let movementFrames = 0;
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1].wrist;
      const curr = samples[i].wrist;
      if (prev && curr) {
        movementSum += Math.hypot(curr.x - prev.x, curr.y - prev.y);
        movementFrames += 1;
      }
    }
    const meanMovement = movementFrames ? movementSum / movementFrames : 0;
    const gestureActivity = Math.min(meanMovement / GESTURE_FULL_SCALE, 1);

    // Collapse the per-sample facing flags into a timeline of gaze events.
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

    return {
      cameraFacingPct,
      smilePct,
      handsVisiblePct,
      gestureActivity: Math.round(gestureActivity * 100) / 100,
      gazeEvents,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
