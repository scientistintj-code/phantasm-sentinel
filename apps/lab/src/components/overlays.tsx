"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { OverlayConfig } from "@/lib/storefronts";

type Phase = "boot" | "age" | "cookie" | "waiting" | "newsletter" | "done";

function closeDelayMs(pattern: OverlayConfig["newsletter"]): number {
  if (pattern === "delay") {
    return 3000;
  }
  if (pattern === "countdown") {
    return 4000;
  }
  return 0;
}

export function Overlays({
  shopName,
  overlay,
}: {
  shopName: string;
  overlay: OverlayConfig;
}) {
  const [phase, setPhase] = useState<Phase>("boot");
  const [ageNote, setAgeNote] = useState("");
  const [armed, setArmed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [closeReady, setCloseReady] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [reopened, setReopened] = useState(false);
  const [kept, setKept] = useState(false);
  const [cookieShownAt, setCookieShownAt] = useState<number | null>(null);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const delay = closeDelayMs(overlay.newsletter);
  const canClose = delay === 0 || closeReady;

  useEffect(() => {
    const ageOk = document.cookie
      .split(";")
      .some((row) => row.trim().startsWith("lab_age_ok="));
    if (ageOk) {
      setCookieShownAt(Date.now());
      setPhase("cookie");
      return;
    }
    setPhase("age");
  }, []);

  useEffect(() => {
    if (phase !== "waiting") {
      return;
    }
    const elapsed = cookieShownAt === null ? 0 : Date.now() - cookieShownAt;
    const remaining = Math.max(0, overlay.newsletterDelayMs - elapsed);
    const timer = window.setTimeout(() => setPhase("newsletter"), remaining);
    return () => window.clearTimeout(timer);
  }, [phase, cookieShownAt, overlay.newsletterDelayMs]);

  useEffect(() => {
    if (phase !== "newsletter") {
      return;
    }
    const wait = closeDelayMs(overlay.newsletter);
    setSecondsLeft(Math.ceil(wait / 1000));
    if (wait === 0) {
      setCloseReady(true);
      return;
    }
    setCloseReady(false);
    const started = Date.now();
    const timer = window.setInterval(() => {
      const left = wait - (Date.now() - started);
      if (left <= 0) {
        setSecondsLeft(0);
        setCloseReady(true);
        window.clearInterval(timer);
        return;
      }
      setSecondsLeft(Math.ceil(left / 1000));
    }, 200);
    return () => window.clearInterval(timer);
  }, [phase, overlay.newsletter, reopened]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      if (phase === "age") {
        setArmed(false);
        setAgeNote("This shop is for adults. Yes is required to enter.");
        return;
      }
      if (phase === "cookie") {
        dismissCookie();
        return;
      }
      if (phase === "newsletter" && canClose) {
        dismissNewsletter();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (phase === "age" || phase === "cookie" || phase === "newsletter") {
      panelRef.current?.focus();
    }
  }, [phase, armed, reopened]);

  useEffect(() => {
    const frame = document.getElementById("site-frame");
    const lock =
      phase === "age" ||
      phase === "newsletter" ||
      (phase === "cookie" && overlay.cookie === "modal");
    if (frame instanceof HTMLElement) {
      frame.inert = lock;
    }
    if (phase === "cookie") {
      document.body.dataset.banner = overlay.cookie;
    } else {
      delete document.body.dataset.banner;
    }
    document.body.style.overflow = lock ? "hidden" : "";
    return () => {
      if (frame instanceof HTMLElement) {
        frame.inert = false;
      }
      delete document.body.dataset.banner;
      document.body.style.overflow = "";
    };
  }, [phase, overlay.cookie]);

  function acceptAge() {
    if (overlay.age === "checkbox" && !checked) {
      return;
    }
    if (overlay.age === "twice" && !armed) {
      setArmed(true);
      setAgeNote("");
      return;
    }
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `lab_age_ok=yes; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    setAgeNote("");
    setCookieShownAt(Date.now());
    setPhase("cookie");
  }

  function dismissCookie() {
    setPhase("waiting");
  }

  function declineAge() {
    setArmed(false);
    setAgeNote("This shop is for adults. Yes is required to enter.");
  }

  function dismissNewsletter() {
    if (!canClose) {
      return;
    }
    if (overlay.newsletter === "reopen" && !reopened) {
      setReopened(true);
      setCloseReady(false);
      setKept(false);
      setCookieShownAt(Date.now());
      setPhase("waiting");
      return;
    }
    setPhase("done");
  }

  function saveNewsletter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setKept(true);
  }

  if (phase !== "age" && phase !== "cookie" && phase !== "newsletter") {
    return null;
  }

  const pattern =
    phase === "age"
      ? overlay.age
      : phase === "cookie"
        ? overlay.cookie
        : overlay.newsletter;
  const title =
    phase === "age" ? shopName : phase === "cookie" ? "Cookies" : "Newsletter";
  const closeLabel =
    overlay.newsletter === "inert"
      ? "Maybe later"
      : canClose
        ? "Close"
        : `Close (${secondsLeft})`;

  return (
    <div className="overlay-root" data-kind={phase} data-pattern={pattern}>
      <div
        className="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
      >
        <h2 id={titleId}>{title}</h2>
        {phase === "age" ? (
          <>
            <p>
              {overlay.age === "twice" && armed
                ? "Confirm once more that you are 18 or older."
                : "Are you 18 or older?"}
            </p>
            <p className="age-note">{ageNote}</p>
            {overlay.age === "checkbox" ? (
              <label className="choice">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                I confirm I am 18 or older.
              </label>
            ) : null}
            <div className="age-actions">
              <button
                type="button"
                className="btn age-yes"
                disabled={overlay.age === "checkbox" && !checked}
                onClick={acceptAge}
              >
                {overlay.age === "twice" && armed
                  ? "Yes, I am 18 or older"
                  : "Yes"}
              </button>
              <button
                type="button"
                className="btn btn-ghost age-no"
                onClick={declineAge}
              >
                No
              </button>
            </div>
          </>
        ) : null}
        {phase === "cookie" ? (
          <>
            <p>
              Accept or reject. Neither sets another cookie. The age gate is
              already remembered.
            </p>
            <div className="panel-actions">
              <button type="button" className="btn" onClick={dismissCookie}>
                Accept
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={dismissCookie}
              >
                Reject
              </button>
            </div>
          </>
        ) : null}
        {phase === "newsletter" ? (
          <>
            <p>{overlay.pitch}</p>
            {reopened ? <p>Still here.</p> : null}
            <form onSubmit={saveNewsletter} autoComplete="off">
              <label className="stack-label">
                Email
                <input
                  type="email"
                  name="lab_newsletter_email"
                  autoComplete="off"
                  maxLength={120}
                />
              </label>
              <div className="panel-actions">
                <button type="submit" className="btn">
                  Save my spot
                </button>
                <button
                  type="button"
                  className="btn btn-ghost news-close"
                  disabled={!canClose}
                  onClick={dismissNewsletter}
                >
                  {closeLabel}
                </button>
              </div>
            </form>
            {kept ? <p>Nothing was sent or stored.</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
