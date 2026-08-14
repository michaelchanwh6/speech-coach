// LLM-generated coaching feedback. Metrics are computed deterministically
// elsewhere; this layer turns them into warm, specific, brief coaching prose
// via a Claude model through the Vercel AI Gateway (AI SDK `generateObject`).
//
// This deliberately overrides ARCHITECTURE.md's rule-based plan (owner choice):
// less code, and pitch/content-aware feedback the transcript itself informs.

import { generateObject } from "ai";
import { z } from "zod";
import type { RecordingContext } from "./audioMetrics";
import { WPM_TARGETS } from "./audioMetrics";

// Overridable so the exact gateway model slug can be bumped without a code
// change. Defaults to a current Claude model known to the AI Gateway.
const FEEDBACK_MODEL = process.env.FEEDBACK_MODEL ?? "anthropic/claude-sonnet-4.5";

const CONTEXT_LABEL: Record<RecordingContext, string> = {
  conversational: "conversational speaking",
  formal: "a formal presentation",
  interview: "an interview",
  pitch: "an investor pitch",
};

const feedbackSchema = z.object({
  summary: z
    .string()
    .describe(
      "One or two warm sentences that lead with a genuine win, then name the single most important thing to work on. No metric dumps."
    ),
  strengths: z
    .array(z.string())
    .min(1)
    .max(2)
    .describe("One or two specific things the speaker did well."),
  focusAreas: z
    .array(z.string())
    .min(1)
    .max(2)
    .describe(
      "One or two specific, actionable things to improve next time. Kind and concrete, never harsh."
    ),
});

export type CoachFeedback = z.infer<typeof feedbackSchema>;

export type FeedbackInput = {
  context: RecordingContext;
  durationSec: number;
  transcript: string;
  wpmAvg: number | null;
  fillerCount: number | null;
  fillerExamples: string[];
  awkwardPauseCount: number;
  rushedFlag: boolean | null;
  // Vision signals — present only when the speaker recorded with video on.
  cameraFacingPct?: number | null;
  smilePct?: number | null;
  handsVisiblePct?: number | null;
  gestureActivity?: number | null;
};

const SYSTEM_PROMPT = `You are a warm, encouraging public-speaking and pitch coach.
Your feedback is brief, specific, and kind — you coach, you never lecture or drill.
Always lead with a real strength before naming what to work on.
Reference concrete details from the speech and the metrics, but never dump raw numbers robotically.
Note when a signal is only a rough proxy (e.g. filler detection can over-count words like "like" or "so"; camera-facing and smile are on-device estimates, not judgments of the person).
Keep every field tight — this is a quick post-practice debrief, not an essay.`;

function buildPrompt(input: FeedbackInput): string {
  const target = WPM_TARGETS[input.context];
  const lines: string[] = [];

  const contextLabel = CONTEXT_LABEL[input.context];
  lines.push(`Speaking context: ${contextLabel}`);
  lines.push(`Duration: ${Math.round(input.durationSec)}s`);

  if (input.wpmAvg != null) {
    lines.push(
      `Average pace: ${input.wpmAvg} WPM (target for ${contextLabel}: ${target.min}-${target.max} WPM)`
    );
  }
  if (input.fillerCount != null) {
    const examples = input.fillerExamples.length
      ? ` (e.g. ${input.fillerExamples.join(", ")})`
      : "";
    lines.push(
      `Filler words: ${input.fillerCount}${examples} — note this can over-count ordinary uses of "like"/"so".`
    );
  }
  lines.push(`Awkward pauses (>2.5s): ${input.awkwardPauseCount}`);
  if (input.rushedFlag != null) {
    lines.push(
      `Rushed delivery (no real breathing pauses): ${input.rushedFlag ? "yes" : "no"}`
    );
  }

  const hasVision =
    input.cameraFacingPct != null ||
    input.smilePct != null ||
    input.handsVisiblePct != null;
  if (hasVision) {
    lines.push("On-device vision signals (rough proxies):");
    if (input.cameraFacingPct != null)
      lines.push(`- Facing the camera: ${input.cameraFacingPct}% of the time`);
    if (input.smilePct != null)
      lines.push(`- Positive/smiling expression: ${input.smilePct}% of the time`);
    if (input.handsVisiblePct != null)
      lines.push(`- Hands visible: ${input.handsVisiblePct}% of the time`);
    if (input.gestureActivity != null)
      lines.push(
        `- Gesture activity: ${Math.round(input.gestureActivity * 100)}/100 (0 = still, 100 = very animated)`
      );
  }

  lines.push("");
  lines.push("Transcript:");
  lines.push(input.transcript.trim() || "(no speech detected)");

  return lines.join("\n");
}

export async function generateFeedback(
  input: FeedbackInput
): Promise<CoachFeedback> {
  const { object } = await generateObject({
    model: FEEDBACK_MODEL,
    schema: feedbackSchema,
    system: SYSTEM_PROMPT,
    prompt: buildPrompt(input),
  });
  return object;
}
