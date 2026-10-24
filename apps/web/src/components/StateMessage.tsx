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
      <p className="muted" role="status">
        {children}
      </p>
    );
  }
  return <p className="muted">{children}</p>;
}
