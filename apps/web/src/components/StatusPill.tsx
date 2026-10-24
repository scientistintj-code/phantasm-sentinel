"use client";

import { useEffect, useState } from "react";

type PillState = "checking" | "online" | "offline";

export function StatusPill() {
  const [state, setState] = useState<PillState>("checking");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/sentinel/v1/health/keys", {
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        setState(response.ok ? "online" : "offline");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("offline");
      });
    return () => controller.abort();
  }, []);

  const label = state === "checking" ? "CHECKING" : state === "online" ? "ONLINE" : "OFFLINE";
  const tone = state === "online" ? "status-running" : state === "offline" ? "status-offline" : "";

  return (
    <div className={`status ${tone}`.trim()} role="status">
      <i aria-hidden="true" />
      SYSTEM {label}
    </div>
  );
}
