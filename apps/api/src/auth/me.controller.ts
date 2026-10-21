import { Controller, Get, Inject, UnauthorizedException } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../infra/prisma.service";
import { Authenticated, CurrentSession, UNAUTHENTICATED_BODY } from "./session.guard";
import type { ActiveSession } from "./session.service";

export class MeResponse {
  @ApiProperty({ description: "DiffSentinel user id." })
  id!: string;

  @ApiProperty({ description: "GitHub login." })
  login!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: "GitHub display name." })
  displayName!: string | null;
}

@ApiTags("auth")
@Controller("me")
@Authenticated()
export class MeController {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  @Get()
  @ApiOperation({ summary: "The signed-in user." })
  @ApiOkResponse({ type: MeResponse })
  async me(@CurrentSession() session: ActiveSession): Promise<MeResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      select: { id: true, login: true, displayName: true },
    });
    if (!user) throw new UnauthorizedException(UNAUTHENTICATED_BODY);
    return user;
  }
}
