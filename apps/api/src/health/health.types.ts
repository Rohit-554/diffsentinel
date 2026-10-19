/** Fixed failure categories; health responses never carry raw error text. */
export type CheckErrorCategory = "timeout" | "unreachable";

export type DependencyCheck =
  | { status: "up"; latencyMs: number }
  | { status: "down"; latencyMs: number; error: CheckErrorCategory };

export interface LivenessResponse {
  status: "ok";
  service: "api";
  version: string;
}

export interface ReadinessResponse {
  status: "ok" | "unavailable";
  service: "api";
  checks: Record<string, DependencyCheck>;
}
