export function StatusBanners({
  apiError,
  onRetry,
  reconnecting,
  keyNotice,
}: {
  apiError: string | null;
  onRetry: () => void;
  reconnecting: boolean;
  keyNotice: string | null;
}) {
  return (
    <>
      {apiError ? (
        <p className="error-banner" role="alert">
          <span>{apiError}</span>
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : null}
      {reconnecting ? (
        <p className="reconnecting-banner" role="status">
          Reconnecting to event stream
        </p>
      ) : null}
      {keyNotice ? (
        <p className="keys-banner" role="status">
          {keyNotice}
        </p>
      ) : null}
    </>
  );
}
