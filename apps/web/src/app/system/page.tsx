import { keyHealthListSchema, type KeyHealth } from "@phantasm/core";

import { sentinelFetch } from "@/lib/proxy";
import packageJson from "../../../package.json";

export const dynamic = "force-dynamic";

type KeyResult = { ok: true; keys: KeyHealth[] } | { ok: false; detail: string };

async function loadKeys(): Promise<KeyResult> {
  try {
    const response = await sentinelFetch("/v1/health/keys");
    const text = await response.text();
    if (!response.ok) return { ok: false, detail: "Key pool is unavailable." };
    let body: unknown;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      return { ok: false, detail: "Key pool response was not valid." };
    }
    const parsed = keyHealthListSchema.safeParse(body);
    if (!parsed.success) return { ok: false, detail: "Key pool response was not valid." };
    return { ok: true, keys: parsed.data };
  } catch {
    return { ok: false, detail: "Key pool is unavailable." };
  }
}

export default async function SystemPage() {
  const health = await loadKeys();
  const build = process.env.SENTINEL_BUILD_SHA?.trim() || "local";

  return (
    <main className="stack">
      <section className="panel" aria-labelledby="key-pool-title">
        <h1 id="key-pool-title" className="panel-title">
          KEY POOL
          <i />
        </h1>
        {health.ok ? (
          health.keys.length === 0 ? (
            <p className="muted">No keys reported.</p>
          ) : (
            <ul className="key-grid">
              {health.keys.map((key) => (
                <li key={key.label} className={`key-square key-${key.state}`}>
                  <span className={`badge badge-${key.state}`}>{key.state}</span>
                  <strong>{key.label}</strong>
                  <span>{key.in_flight} in flight</span>
                  <span>{key.runs_served} runs served</span>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="muted">{health.detail}</p>
        )}
      </section>
      <section className="panel" aria-labelledby="build-title">
        <h2 id="build-title" className="panel-title">
          BUILD
          <i />
        </h2>
        <dl className="build-list">
          <div>
            <dt>APPLICATION</dt>
            <dd>phantasm-web</dd>
          </div>
          <div>
            <dt>VERSION</dt>
            <dd>{packageJson.version}</dd>
          </div>
          <div>
            <dt>BUILD</dt>
            <dd>{build}</dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
