import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { HealthService } from "./health.service";
import type { LivenessResponse, ReadinessResponse } from "./health.types";

@ApiTags("health")
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ description: "The API process is running." })
  liveness(): LivenessResponse {
    return this.health.liveness();
  }

  @Get("ready")
  @ApiOkResponse({ description: "PostgreSQL and Redis are reachable." })
  @ApiServiceUnavailableResponse({ description: "At least one dependency is down." })
  async readiness(): Promise<ReadinessResponse> {
    const result = await this.health.readiness();
    if (result.status !== "ok") {
      // Nest uses an object argument as the response body, so clients get the
      // same shape as a 200 response with per-dependency results.
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
