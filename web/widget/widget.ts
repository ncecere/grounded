/*
 * The embeddable widget loader (docs/phase4-publishing.md §6), served as
 * /widget.js. Plain TypeScript, no framework, built separately (vite.widget.config.ts).
 *
 *   <script src="https://rag.example.edu/widget.js" data-agent="{uuid}" data-key="pk_…"
 *           data-position="bottom-right" async></script>
 *
 * It adds a launcher button in a shadow root (nothing leaks into the page's
 * CSS, and the page's CSS can't reach it) that opens an iframe panel with
 * Grounded's embed page. Esc closes the panel (the embed page forwards Esc from
 * inside the frame) and focus returns to the launcher. On a phone the panel
 * fills the screen and the launcher hides meanwhile (it would cover the chat;
 * the panel's header closes it). Optional attributes:
 * data-name and data-accent (otherwise read from the public profile), and
 * data-position="bottom-left".
 *
 * Light or dark follows the visitor's system setting (VI-38): the embed page
 * does so itself; in dark the launcher gets a light ring (a dark accent on a
 * dark page would vanish) and a white focus ring, and the panel is dark
 * before the frame loads.
 *
 * Before showing anything it asks Grounded whether the key works on this page's
 * origin (GET /v1/public/agents/{id}/widget-check). On a site the key
 * doesn't allow (or with a revoked key, a disabled agent, public chat
 * turned off) there is no launcher, only a console warning for the site
 * owner (docs/ui-review F-09).
 */

type Profile = { name: string; accentColor: string };

/** An agent without an accent: the theme's primary, as in the app (web/src/pages/agents/accents.colors.ts). */
const DEFAULT_ACCENT = "#4b4fd6";
const HEX = /^#[0-9a-f]{6}$/i;

/** The launcher and panel styles, scoped to the shadow root. */
const css = (accent: string, left: boolean) => `
:host{all:initial}
*{box-sizing:border-box}
.l,.p{position:fixed;${left ? "left" : "right"}:20px;z-index:2147483000;font:14px/1.4 system-ui,sans-serif}
.l{bottom:20px;width:56px;height:56px;border:0;border-radius:50%;background:${accent};color:#fff;cursor:pointer;display:grid;place-items:center;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.l:focus-visible{outline:3px solid ${accent};outline-offset:3px}
.x:focus-visible{outline:2px solid #fff;outline-offset:-2px}
.l svg{width:26px;height:26px}
.p{bottom:88px;width:380px;height:600px;max-height:calc(100vh - 108px);max-width:calc(100vw - 40px);background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;flex-direction:column}
.p[hidden]{display:none}
.h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 8px 8px 14px;background:${accent};color:#fff;font-weight:600}
.x{border:0;background:transparent;color:#fff;width:32px;height:32px;border-radius:6px;cursor:pointer;display:grid;place-items:center}
.x svg{width:18px;height:18px}
iframe{border:0;width:100%;flex:1}
@media (prefers-color-scheme:dark){.l{box-shadow:0 0 0 2px rgba(255,255,255,.85),0 4px 16px rgba(0,0,0,.5)}.l:focus-visible{outline-color:#fff}.p{background:#0b0d12;box-shadow:0 0 0 1px rgba(255,255,255,.14),0 8px 32px rgba(0,0,0,.6)}}
@media (max-width:480px){.p{${left ? "left" : "right"}:0;bottom:0;width:100vw;max-width:100vw;height:100%;max-height:100%;border-radius:0}.p:not([hidden])+.l{display:none}}
@media (prefers-reduced-motion:no-preference){.p{transition:opacity .15s}}`;

const chatIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const closeIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string>, html = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.innerHTML = html;
  return e;
}

type Check = { allowed: boolean; code: string | null; message: string | null; name?: string | null; accentColor?: string | null };

/** Asks Grounded whether to show the widget here; null when Grounded can't be reached (show it: the panel explains). */
async function check(base: string, agent: string, key: string): Promise<Check | null> {
  const url = `${base}/v1/public/agents/${encodeURIComponent(agent)}/widget-check?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(location.origin)}`;
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (res.ok) return ((await res.json()) as { data: Check }).data;
    if (res.status === 404) return { allowed: false, code: "agent_not_found", message: "No such assistant." };
  } catch {
    // Offline or blocked: fall through.
  }
  return null;
}

function profileOf(script: HTMLScriptElement, c: Check | null): Profile {
  const d = script.dataset;
  return { name: d.name || c?.name || "the assistant", accentColor: d.accent ?? c?.accentColor ?? "" };
}

function mount(script: HTMLScriptElement, base: string, agent: string, key: string, p: Profile) {
  const accent = HEX.test(p.accentColor) ? p.accentColor : DEFAULT_ACCENT;
  const left = script.dataset.position === "bottom-left";
  const label = `Chat with ${p.name}`;
  const host = el("div", { "data-grounded-widget": "" });
  const root = host.attachShadow({ mode: "closed" });
  root.appendChild(el("style", {}, css(accent, left)));
  const launcher = el("button", { type: "button", class: "l", "aria-label": label, "aria-expanded": "false", "aria-controls": "grounded-panel" }, chatIcon);
  const panel = el("div", { class: "p", id: "grounded-panel", role: "dialog", "aria-label": label, hidden: "" });
  const head = el("div", { class: "h" });
  head.appendChild(el("span", {})).textContent = p.name;
  const close = el("button", { type: "button", class: "x", "aria-label": "Close chat" }, closeIcon);
  head.appendChild(close);
  panel.appendChild(head);
  root.append(panel, launcher);
  document.body.appendChild(host);

  let frame: HTMLIFrameElement | null = null;
  const isOpen = () => !panel.hasAttribute("hidden");
  const open = () => {
    if (!frame) {
      const src = `${base}/embed/${encodeURIComponent(agent)}?key=${encodeURIComponent(key)}`;
      frame = el("iframe", { src, title: label, allow: "clipboard-write" });
      panel.appendChild(frame);
    }
    panel.removeAttribute("hidden");
    launcher.setAttribute("aria-expanded", "true");
    frame.focus();
    frame.contentWindow?.postMessage({ type: "grounded-widget:focus" }, base);
  };
  const shut = () => {
    if (!isOpen()) return;
    panel.setAttribute("hidden", "");
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  };
  launcher.addEventListener("click", () => (isOpen() ? shut() : open()));
  close.addEventListener("click", shut);
  root.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") shut();
  });
  window.addEventListener("message", (e) => {
    if (e.origin === base && frame && e.source === frame.contentWindow && (e.data as { type?: string })?.type === "grounded-widget:close") shut();
  });
}

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const agent = script?.dataset.agent;
  const key = script?.dataset.key;
  if (!script || !agent || !key) {
    console.warn("Grounded widget: data-agent and data-key are required");
    return;
  }
  const base = new URL(script.src).origin;
  const start = () =>
    void check(base, agent, key).then((c) => {
      if (c && !c.allowed) {
        console.warn(`Grounded widget: not shown on ${location.origin}: ${c.message ?? c.code} (${c.code}). Add this origin to the widget key's allowed origins in Grounded, or check the key.`);
        return;
      }
      mount(script, base, agent, key, profileOf(script, c));
    });
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();

// A module for type-checking and tests; the build emits a plain script (no exports).
export {};
