import { useQuery } from "@tanstack/react-query";
import { fetchReadiness } from "../api/health";

const REFRESH_MS = 10_000;

/** Shows whether the system is operational, with each dependency's state in text. */
export function SystemStatus() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["health", "ready"],
    queryFn: ({ signal }) => fetchReadiness(signal),
    refetchInterval: REFRESH_MS,
    retry: false,
  });

  return (
    <section aria-labelledby="system-status-heading">
      <h2 id="system-status-heading">System status</h2>
      <div role="status" aria-live="polite">
        {isPending ? (
          <p>Checking system status…</p>
        ) : isError ? (
          <p className="status status-down">
            <strong>API unavailable.</strong> The dashboard cannot reach the API right now.
          </p>
        ) : (
          <>
            <p className={`status ${data.status === "ok" ? "status-up" : "status-down"}`}>
              <strong>
                {data.status === "ok" ? "All systems operational" : "System degraded"}
              </strong>
            </p>
            <ul className="checks">
              {Object.entries(data.checks).map(([name, check]) => (
                <li key={name}>
                  <span className="check-name">{name}</span>:{" "}
                  <span className={check.status === "up" ? "status-up" : "status-down"}>
                    {check.status}
                  </span>
                  {check.error ? ` (${check.error})` : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
