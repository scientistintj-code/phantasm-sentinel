import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
import "@phantasm/core/tokens.css";
import "./styles/dashboard.css";
import "./styles/states.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

function ensureMeta(name: string, content: string): void {
  const property = name.startsWith("og:");
  const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
  const existing = document.head.querySelector(selector);
  const meta = existing instanceof HTMLMetaElement ? existing : document.createElement("meta");
  if (property) meta.setAttribute("property", name);
  else meta.setAttribute("name", name);
  meta.content = content;
  if (meta.parentElement === null) document.head.appendChild(meta);
}

const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#070b13"/><path d="M16 4 28 10v12L16 28 4 22V10Z" fill="none" stroke="#22d3ee" stroke-width="1.5"/></svg>',
  );

document.title = "Console · Phantasm Sentinel";
ensureMeta("description", "Phantasm Sentinel forensic console.");
ensureMeta("og:title", "Console · Phantasm Sentinel");
ensureMeta("og:description", "Phantasm Sentinel forensic console.");
ensureMeta("og:type", "website");
const favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']") ?? document.createElement("link");
favicon.rel = "icon";
favicon.type = "image/svg+xml";
favicon.href = ICON;
if (favicon.parentElement === null) document.head.appendChild(favicon);

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing #root");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
