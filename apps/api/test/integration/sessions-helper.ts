import type { PrismaClient } from "@prisma/client";
import { SessionService } from "../../src/auth/session.service";

/** Creates a user (if needed) and a session directly, returning the Cookie header value. */
export async function signedInAs(
  prisma: PrismaClient,
  githubUserId: number,
  login: string,
): Promise<{ userId: string; cookie: string; token: string }> {
  const user = await prisma.user.upsert({
    where: { githubUserId: BigInt(githubUserId) },
    create: { githubUserId: BigInt(githubUserId), login, displayName: login.toUpperCase() },
    update: {},
  });
  const { token } = await new SessionService(prisma, { sessionTtlHours: 8 }).create(user.id);
  return { userId: user.id, cookie: `ds_session=${token}`, token };
}
