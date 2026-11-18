"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";

const LANGUAGES = [
  { value: "hi", label: "Hindi" },
  { value: "en", label: "English" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "bn", label: "Bengali" },
  { value: "mr", label: "Marathi" },
] as const;

type Sex = "M" | "F" | "O";
type PreferredLang = (typeof LANGUAGES)[number]["value"];

const STATUS_LABEL: Record<
  "recording" | "uploaded" | "processing" | "completed" | "failed",
  string
> = {
  recording: "Recording",
  uploaded: "Uploaded",
  processing: "Processing",
  completed: "Completed",
  failed: "Failed",
};

export default function DashboardPage() {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const patient = useQuery(api.patients.getMyPatient, isAuthenticated ? {} : "skip");
  const screenings = useQuery(
    api.screenings.getMyScreenings,
    isAuthenticated ? {} : "skip",
  );
  const upsertPatient = useMutation(api.patients.upsertPatient);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/signin");
    }
  }, [isAuthenticated, isLoading, router]);

  async function handleSignOut() {
    await signOut();
    router.replace("/signin");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
        <p className="text-lg font-semibold tracking-tight text-teal-900">SpiroVoice</p>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
        >
          Sign Out
        </button>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-8">
        {isLoading || !isAuthenticated || patient === undefined ? (
          <p className="text-sm text-zinc-500">Loading your profile…</p>
        ) : patient === null ? (
          <PatientIntake
            onSubmit={async (values) => {
              await upsertPatient(values);
            }}
          />
        ) : (
          <>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-zinc-950">Your screenings</h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Profile on file · {patient.age} years · {languageLabel(patient.preferredLang)}
                </p>
              </div>
              <Link
                href="/screening/new"
                className="inline-flex items-center justify-center rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
              >
                New Respiratory Screening
              </Link>
            </div>
            {screenings === undefined ? (
              <p className="text-sm text-zinc-500">Loading history…</p>
            ) : screenings.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-zinc-300 bg-white px-5 py-8 text-sm text-zinc-500">
                No screenings yet. Start with a cough sample and a short voice intake.
              </p>
            ) : (
              <ul className="space-y-4">
                {screenings.map((screening) => (
                  <li
                    key={screening._id}
                    className="rounded-2xl border border-zinc-200 bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm text-zinc-500">
                        {new Date(screening._creationTime).toLocaleString()}
                      </p>
                      <StatusBadge status={screening.status} />
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="text-zinc-500">Risk score</dt>
                        <dd className="font-medium text-zinc-950">
                          {screening.riskScore === undefined ? "—" : screening.riskScore}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-zinc-500">Predicted conditions</dt>
                        <dd className="font-medium text-zinc-950">
                          {screening.predictedConditions &&
                          screening.predictedConditions.length > 0
                            ? screening.predictedConditions.join(", ")
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    {screening.transcripts && screening.transcripts.length > 0 ? (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm text-zinc-500">Transcripts</p>
                        {screening.transcripts.map((transcript) => (
                          <p
                            key={`${screening._id}-${transcript.channel}`}
                            className="text-sm text-zinc-800"
                          >
                            <span className="font-medium capitalize">{transcript.channel}: </span>
                            {transcript.text}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "recording" | "uploaded" | "processing" | "completed" | "failed";
}) {
  const tone =
    status === "completed"
      ? "bg-emerald-50 text-emerald-800"
      : status === "failed"
        ? "bg-rose-50 text-rose-800"
        : status === "processing"
          ? "bg-indigo-50 text-indigo-800"
          : status === "uploaded"
            ? "bg-sky-50 text-sky-800"
            : "bg-amber-50 text-amber-800";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function languageLabel(code: PreferredLang) {
  return LANGUAGES.find((language) => language.value === code)?.label ?? code;
}

function PatientIntake({
  onSubmit,
}: {
  onSubmit: (values: {
    age: number;
    sex: Sex;
    preferredLang: PreferredLang;
    smokingHistory: boolean;
  }) => Promise<void>;
}) {
  const [age, setAge] = useState("");
  const [sex, setSex] = useState<Sex>("M");
  const [preferredLang, setPreferredLang] = useState<PreferredLang>("hi");
  const [smokingHistory, setSmokingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAge = Number(age);
    if (!Number.isInteger(parsedAge) || parsedAge < 1 || parsedAge > 120) {
      setError("Enter an age from 1 to 120.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit({
        age: parsedAge,
        sex,
        preferredLang,
        smokingHistory,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the profile.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-2xl border border-zinc-200 bg-white p-6"
    >
      <h1 className="text-2xl font-semibold text-zinc-950">Patient intake</h1>
      <p className="mt-1 text-sm text-zinc-500">
        This profile stays with your account and is used for each screening.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-zinc-800">
          Age
          <input
            required
            inputMode="numeric"
            value={age}
            onChange={(event) => setAge(event.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-teal-700"
          />
        </label>
        <label className="text-sm font-medium text-zinc-800">
          Sex
          <select
            value={sex}
            onChange={(event) => setSex(event.target.value as Sex)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-teal-700"
          >
            <option value="M">Male</option>
            <option value="F">Female</option>
            <option value="O">Other</option>
          </select>
        </label>
        <label className="text-sm font-medium text-zinc-800 sm:col-span-2">
          Preferred language
          <select
            value={preferredLang}
            onChange={(event) => setPreferredLang(event.target.value as PreferredLang)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-950 outline-none focus:border-teal-700"
          >
            {LANGUAGES.map((language) => (
              <option key={language.value} value={language.value}>
                {language.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-3 sm:col-span-2">
          <span className="text-sm font-medium text-zinc-800">Smoking history</span>
          <button
            type="button"
            role="switch"
            aria-checked={smokingHistory}
            onClick={() => setSmokingHistory((current) => !current)}
            className={`relative h-7 w-12 rounded-full transition-colors ${
              smokingHistory ? "bg-teal-700" : "bg-zinc-300"
            }`}
          >
            <span
              className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                smokingHistory ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-4 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="mt-6 rounded-full bg-teal-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:bg-zinc-300"
      >
        {pending ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
