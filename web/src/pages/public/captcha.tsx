/* Cloudflare Turnstile on session creation, when the platform uses it (docs/phase4-publishing.md §2 decision 4). */
import { useEffect, useRef } from "react";
import p from "./public.module.css";

type TurnstileAPI = {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void }) => string;
  remove?: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}

const scriptURL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = scriptURL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error("The verification couldn't load."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

/** Renders the Turnstile challenge; onToken gets the token ("" when it expires). */
export function Turnstile({ siteKey, onToken }: { siteKey: string; onToken: (token: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  useEffect(() => {
    let id: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (!cancelled && ref.current && window.turnstile)
          id = window.turnstile.render(ref.current, { sitekey: siteKey, callback: (t) => cb.current(t), "expired-callback": () => cb.current("") });
      })
      .catch(() => cb.current(""));
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove?.(id);
    };
  }, [siteKey]);
  return <div ref={ref} className={p.captcha} />;
}
