export function StateMessage({
  kind,
  children,
}: {
  kind: "loading" | "empty" | "error";
  children: React.ReactNode;
}) {
  if (kind === "error") {
    return (
      <p className="muted" role="alert">
        {children}
      </p>
    );
  }
  if (kind === "loading") {
    return (
      <>
        <p className="sr-only" role="status">
          {children}
        </p>
        <div className="skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
      </>
    );
  }
  return <p className="muted">{children}</p>;
}
