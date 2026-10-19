import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatus } from "./SystemStatus";

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SystemStatus />
    </QueryClientProvider>,
  );
}

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

describe("SystemStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the system as operational when every dependency is up", async () => {
    mockFetch(200, {
      status: "ok",
      service: "api",
      checks: {
        postgres: { status: "up", latencyMs: 3 },
        redis: { status: "up", latencyMs: 1 },
      },
    });
    renderStatus();

    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
    expect(screen.getByText("postgres").parentElement).toHaveTextContent("postgres: up");
    expect(screen.getByText("redis").parentElement).toHaveTextContent("redis: up");
  });

  it("shows the system as degraded and names the dependency that is down", async () => {
    mockFetch(503, {
      status: "unavailable",
      service: "api",
      checks: {
        postgres: { status: "up", latencyMs: 3 },
        redis: { status: "down", latencyMs: 2000, error: "timeout" },
      },
    });
    renderStatus();

    expect(await screen.findByText("System degraded")).toBeInTheDocument();
    expect(screen.getByText("redis").parentElement).toHaveTextContent("redis: down (timeout)");
  });

  it("shows API unavailable when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderStatus();

    expect(await screen.findByText("API unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "System status" })).toBeVisible();
  });

  it("shows API unavailable when the response is not a readiness report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>Bad gateway</html>", { status: 502 })),
    );
    renderStatus();

    expect(await screen.findByText("API unavailable.")).toBeInTheDocument();
  });

  it("announces status changes to assistive technology", async () => {
    mockFetch(200, { status: "ok", service: "api", checks: {} });
    renderStatus();

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(await screen.findByText("All systems operational")).toBeInTheDocument();
  });
});
