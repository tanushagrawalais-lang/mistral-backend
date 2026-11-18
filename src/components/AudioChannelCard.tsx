"use client";

import { useEffect, useRef, useState } from "react";

export type AudioChannelType = "cough" | "speech";

type AudioChannelCardProps = {
  type: AudioChannelType;
  maxDurationSec: number;
  title: string;
  onRecordingComplete: (blob: Blob) => Promise<void>;
  disabled?: boolean;
  uploaded?: boolean;
};

export function AudioChannelCard({
  type,
  maxDurationSec,
  title,
  onRecordingComplete,
  disabled = false,
  uploaded = false,
}: AudioChannelCardProps) {
  const [phase, setPhase] = useState<"idle" | "recording">("idle");
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopTracks();
      clearTimers();
    };
  }, []);

  function clearTimers() {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickTimerRef.current !== null) {
      window.clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function startRecording() {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot access a microphone.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stopTracks();
        setPhase("idle");
        void onRecordingComplete(blob).catch((cause: unknown) => {
          setError(
            cause instanceof Error ? cause.message : "Could not save this recording.",
          );
        });
      };
      recorderRef.current = recorder;
      recorder.start();
      setElapsedSec(0);
      setPhase("recording");
      const startedAt = Date.now();
      tickTimerRef.current = window.setInterval(() => {
        setElapsedSec(Math.min(maxDurationSec, Math.floor((Date.now() - startedAt) / 1000)));
      }, 200);
      stopTimerRef.current = window.setTimeout(() => {
        stopRecording();
      }, maxDurationSec * 1000);
    } catch {
      stopTracks();
      setPhase("idle");
      setError("Microphone permission is required to record this sample.");
    }
  }

  function stopRecording() {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
      return;
    }
    stopTracks();
    setPhase("idle");
  }

  const remaining = Math.max(0, maxDurationSec - elapsedSec);

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-teal-700">
            {type === "cough" ? "Channel 1" : "Channel 2"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-zinc-950">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Maximum {maxDurationSec} seconds
          </p>
        </div>
        {uploaded ? (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Uploaded
          </span>
        ) : null}
      </div>
      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="font-mono text-2xl tabular-nums text-zinc-900">
          {phase === "recording"
            ? `0:${String(remaining).padStart(2, "0")}`
            : `0:${String(maxDurationSec).padStart(2, "0")}`}
        </p>
        {phase === "recording" ? (
          <button
            type="button"
            onClick={stopRecording}
            className="rounded-full bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700"
          >
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startRecording()}
            disabled={disabled || uploaded}
            className="rounded-full bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {uploaded ? "Recorded" : "Record"}
          </button>
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </section>
  );
}
