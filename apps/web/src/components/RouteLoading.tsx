import { StateMessage } from "./StateMessage";

export function RouteLoading() {
  return (
    <main className="stack">
      <section className="panel" aria-busy="true">
        <StateMessage kind="loading">Loading.</StateMessage>
      </section>
    </main>
  );
}
