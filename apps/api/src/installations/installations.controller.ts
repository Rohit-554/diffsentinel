import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { NOT_CONFIGURED_BODY } from "../auth/auth.controller";
import { Authenticated, CurrentSession } from "../auth/session.guard";
import type { ActiveSession } from "../auth/session.service";
import { TenantScope } from "../authz/tenant-scope.service";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/env";
import { PRISMA_CLIENT } from "../infra/prisma.service";

export class InstallationDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "GitHub account the App is installed on." }) accountLogin!: string;
  @ApiProperty({ example: "Organization" }) accountType!: string;
  @ApiProperty({ enum: ["active", "suspended"] }) status!: "active" | "suspended";
  @ApiProperty({ description: "Repositories in this installation the user can access." })
  repositoryCount!: number;
  @ApiProperty({ description: "The sync stopped at its repository limit." })
  repositoriesTruncated!: boolean;
}

export class InstallationListDto {
  @ApiProperty({ type: [InstallationDto] }) items!: InstallationDto[];
  @ApiProperty({ description: "The sync stopped at its installation limit." }) truncated!: boolean;
}

export class RepositoryDto {
  @ApiProperty() id!: string;
  @ApiProperty() installationId!: string;
  @ApiProperty({ example: "acme/api" }) fullName!: string;
  @ApiProperty({ example: "main" }) defaultBranch!: string;
  @ApiProperty() private!: boolean;
}

export class RepositoryListDto {
  @ApiProperty({ type: [RepositoryDto] }) items!: RepositoryDto[];
}

export class InstallUrlDto {
  @ApiProperty({ example: "https://github.com/apps/diffsentinel/installations/new" }) url!: string;
}

const repositoriesQuery = z.object({ installationId: z.uuid().optional() });

export const INVALID_REQUEST_BODY = {
  error: "invalid_request",
  message: "The request parameters are invalid.",
} as const;

/** Tenant-scoped reads: every query starts from TenantScope. */
@ApiTags("installations")
@Controller()
@Authenticated()
export class InstallationsController {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly scope: TenantScope,
  ) {}

  @Get("installations")
  @ApiOperation({ summary: "Installations the signed-in user can access." })
  @ApiOkResponse({ type: InstallationListDto })
  async installations(@CurrentSession() { userId }: ActiveSession): Promise<InstallationListDto> {
    const [installations, counts, user] = await Promise.all([
      this.prisma.installation.findMany({
        where: this.scope.installationsFor(userId),
        select: {
          id: true,
          accountLogin: true,
          accountType: true,
          status: true,
          members: { where: { userId }, select: { repositoriesTruncated: true } },
        },
        orderBy: { accountLogin: "asc" },
      }),
      this.prisma.repository.groupBy({
        by: ["installationId"],
        where: this.scope.repositoriesFor(userId),
        _count: { _all: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { installationsTruncated: true },
      }),
    ]);
    const countByInstallation = new Map(counts.map((c) => [c.installationId, c._count._all]));

    return {
      truncated: user?.installationsTruncated ?? false,
      items: installations.map((i) => ({
        id: i.id,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        // installationsFor() already excludes "removed".
        status: i.status === "suspended" ? "suspended" : "active",
        repositoryCount: countByInstallation.get(i.id) ?? 0,
        repositoriesTruncated: i.members[0]?.repositoriesTruncated ?? false,
      })),
    };
  }

  @Get("installations/install-url")
  @ApiOperation({ summary: "Where to install the GitHub App." })
  @ApiOkResponse({ type: InstallUrlDto })
  @ApiServiceUnavailableResponse({ description: "GitHub sign-in is not configured." })
  installUrl(): InstallUrlDto {
    if (!this.config.github) throw new ServiceUnavailableException(NOT_CONFIGURED_BODY);
    const slug = encodeURIComponent(this.config.github.appSlug);
    return { url: `https://github.com/apps/${slug}/installations/new` };
  }

  @Get("repositories")
  @ApiOperation({ summary: "Repositories the signed-in user can access." })
  @ApiQuery({ name: "installationId", required: false, format: "uuid" })
  @ApiOkResponse({ type: RepositoryListDto })
  @ApiBadRequestResponse({ description: "installationId is not a valid id." })
  @ApiNotFoundResponse({ description: "No such installation for this user." })
  async repositories(
    @CurrentSession() { userId }: ActiveSession,
    @Query() query: Record<string, unknown>,
  ): Promise<RepositoryListDto> {
    const parsed = repositoriesQuery.safeParse(query);
    if (!parsed.success) throw new BadRequestException(INVALID_REQUEST_BODY);
    const { installationId } = parsed.data;
    if (installationId !== undefined) {
      await this.scope.assertInstallationVisible(userId, installationId);
    }

    const items = await this.prisma.repository.findMany({
      where: this.scope.repositoriesFor(
        userId,
        installationId === undefined ? {} : { installationId },
      ),
      select: {
        id: true,
        installationId: true,
        fullName: true,
        defaultBranch: true,
        private: true,
      },
      orderBy: { fullName: "asc" },
    });
    return { items };
  }
}
