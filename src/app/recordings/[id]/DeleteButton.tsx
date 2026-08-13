"use client";

import { useState, useTransition } from "react";
import { deleteRecording } from "./actions";

export function DeleteButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-red-600"
      >
        Delete this recording
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-gray-600">
        Delete permanently? This can&apos;t be undone.
      </span>
      <button
        disabled={isPending}
        onClick={() => startTransition(() => deleteRecording(id))}
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
      <button
        disabled={isPending}
        onClick={() => setConfirming(false)}
        className="rounded-md border border-gray-300 px-3 py-1.5 font-medium disabled:opacity-50"
      >
        Cancel
      </button>
    </div>
  );
}
