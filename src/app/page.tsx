"use client";

import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Home() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) {
      return;
    }
    router.replace(isAuthenticated ? "/dashboard" : "/signin");
  }, [isAuthenticated, isLoading, router]);

  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <p className="text-sm text-zinc-500">Opening SpiroVoice…</p>
    </main>
  );
}
