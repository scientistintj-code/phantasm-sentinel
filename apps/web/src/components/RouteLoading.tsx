import { StateMessage } from "./StateMessage";

export function RouteLoading() {
  return (
    <main className="stack">
      <section className="panel" aria-busy="true" aria-labelledby="loading-title">
        <h1 id="loading-title" className="panel-title">
          LOADING
          <i />
        </h1>
        <StateMessage kind="loading">Loading.</StateMessage>
      </section>
    </main>
  );
}
