import { methodologyBlocks } from "@/lib/methodology";

import { StateMessage } from "./StateMessage";

export function MethodologyView({
  text,
  error,
  loading = false,
}: {
  text: string | null;
  error: string | null;
  loading?: boolean;
}) {
  const blocks = text === null ? [] : methodologyBlocks(text);

  return (
    <section className="panel" aria-labelledby="methodology-title" aria-busy={loading}>
      <h1 id="methodology-title" className="panel-title">
        METHODOLOGY
        <i />
      </h1>
      {loading ? <StateMessage kind="loading">Loading methodology.</StateMessage> : null}
      {error ? <StateMessage kind="error">{error}</StateMessage> : null}
      {!loading && error === null && text === null ? (
        <StateMessage kind="empty">No methodology text.</StateMessage>
      ) : null}
      {blocks.map((block) => (
        <section key={block.id} className="method-block" aria-labelledby={`method-${block.id}`}>
          <h2 id={`method-${block.id}`}>{block.heading}</h2>
          {block.paragraphs.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {block.quote !== null ? <pre className="dossier-weights">{block.quote}</pre> : null}
          {block.items.length > 0 ? (
            <ul className="method-list">
              {block.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </section>
  );
}
