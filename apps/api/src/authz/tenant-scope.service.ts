import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../infra/prisma.service";

/**
 * The one response for "doesn't exist" and "not yours", so callers can't
 * probe for other tenants' resources.
 */
export const NOT_FOUND_BODY = { error: "not_found", message: "Not found." } as const;

/**
 * The single place tenant filters are built. Access comes only from what the
 * last sync with GitHub recorded:
 * - an installation is visible to its members while its status isn't `removed`;
 * - a repository is visible when, additionally, GitHub reported it as
 *   accessible to that user (members of one installation may see different repos).
 * Every tenant-scoped query must start from these filters.
 */
@Injectable()
export class TenantScope {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  installationsFor(userId: string): Prisma.InstallationWhereInput {
    return { status: { not: "removed" }, members: { some: { userId } } };
  }

  repositoriesFor(
    userId: string,
    filter: { installationId?: string } = {},
  ): Prisma.RepositoryWhereInput {
    return {
      access: { some: { userId } },
      installation: this.installationsFor(userId),
      ...(filter.installationId === undefined ? {} : { installationId: filter.installationId }),
    };
  }

  /** Throws the standard 404 unless the installation is visible to the user. */
  async assertInstallationVisible(userId: string, installationId: string): Promise<void> {
    const visible = await this.prisma.installation.count({
      where: { id: installationId, ...this.installationsFor(userId) },
    });
    if (visible === 0) throw new NotFoundException(NOT_FOUND_BODY);
  }
}
