"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { AudioChannelCard } from "@/components/AudioChannelCard";

type Channel = "cough" | "speech";

export default function NewScreeningPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const patient = useQuery(api.patients.getMyPatient, isAuthenticated ? {} : "skip");
  const generateUploadUrl = useMutation(api.screenings.generateUploadUrl);
  const createScreening = useMutation(api.screenings.createScreening);
  const attachAudio = useMutation(api.screenings.attachAudio);

  const [screeningId, setScreeningId] = useState<Id<"screenings"> | null>(null);
  const [uploaded, setUploaded] = useState<Record<Channel, boolean>>({
    cough: false,
    speech: false,
  });
  const [busyChannel, setBusyChannel] = useState<Channel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const screeningIdRef = useRef<Id<"screenings"> | null>(null);
  const createPromiseRef = useRef<Promise<Id<"screenings">> | null>(null);

  const screening = useQuery(
    api.screenings.getScreening,
    screeningId ? { screeningId } : "skip",
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/signin");
    }
  }, [isAuthenticated, isLoading, router]);

  useEffect(() => {
    if (isAuthenticated && patient === null) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, patient, router]);

  function ensureScreening() {
    if (screeningIdRef.current) {
      return Promise.resolve(screeningIdRef.current);
    }
    if (!createPromiseRef.current) {
      createPromiseRef.current = createScreening({})
        .then((id) => {
          screeningIdRef.current = id;
          setScreeningId(id);
          return id;
        })
        .catch((cause: unknown) => {
          createPromiseRef.current = null;
          throw cause;
        });
    }
    return createPromiseRef.current;
  }

  async function handleRecordingComplete(channel: Channel, blob: Blob) {
    setBusyChannel(channel);
    setError(null);
    try {
      const uploadUrl = await generateUploadUrl({});
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
      });
      if (!response.ok) {
        throw new Error("Audio upload failed.");
      }
      const payload: unknown = await response.json();
      if (!isStoragePayload(payload)) {
        throw new Error("Upload did not return a storage id.");
      }
      const id = await ensureScreening();
      await attachAudio({
        screeningId: id,
        channel,
        storageId: payload.storageId,
      });
      setUploaded((current) => ({ ...current, [channel]: true }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload this sample.");
      throw cause instanceof Error ? cause : new Error("Could not upload this sample.");
    } finally {
      setBusyChannel(null);
    }
  }

  const ready = screening?.status === "uploaded";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <Link href="/dashboard" className="text-lg font-semibold tracking-tight text-teal-900">
          SpiroVoice
        </Link>
        <Link href="/dashboard" className="text-sm font-medium text-zinc-700 hover:text-zinc-950">
          Back to dashboard
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950">New respiratory screening</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Record both samples. Analysis starts after you submit.
          </p>
        </div>
        {isLoading || !isAuthenticated || patient === undefined || patient === null ? (
          <p className="text-sm text-zinc-500">Checking your profile…</p>
        ) : (
          <>
            <AudioChannelCard
              type="cough"
              maxDurationSec={10}
              title="Forced Cough Sample (3 Coughs)"
              disabled={busyChannel !== null}
              uploaded={uploaded.cough}
              onRecordingComplete={(blob) => handleRecordingComplete("cough", blob)}
            />
            <AudioChannelCard
              type="speech"
              maxDurationSec={20}
              title="Symptom Voice Intake (Speak in your preferred language)"
              disabled={busyChannel !== null}
              uploaded={uploaded.speech}
              onRecordingComplete={(blob) => handleRecordingComplete("speech", blob)}
            />
            {error ? (
              <p role="alert" className="text-sm text-rose-700">
                {error}
              </p>
            ) : null}
            {ready ? (
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
              >
                Submit for AI Analysis
              </button>
            ) : (
              <p className="text-sm text-zinc-500">
                Submit unlocks after both channels are uploaded.
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function isStoragePayload(value: unknown): value is { storageId: Id<"_storage"> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "storageId" in value &&
    typeof value.storageId === "string"
  );
}
