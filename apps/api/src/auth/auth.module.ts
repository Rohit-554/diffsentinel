import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { GitHubModule } from "../github/github.module";
import { InstallationSyncModule } from "../installations/installation-sync.module";
import { AuthController } from "./auth.controller";
import { MeController } from "./me.controller";
import { PendingSignInStore } from "./pending-sign-in.store";
import { SameOriginGuard } from "./same-origin.guard";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

/** GitHub sign-in, sessions and the guard other modules use to require a session. */
@Module({
  imports: [AuditModule, GitHubModule, InstallationSyncModule],
  controllers: [AuthController, MeController],
  providers: [
    PendingSignInStore,
    SessionService,
    SessionGuard,
    // Applies to every route in the app, not just this module's.
    { provide: APP_GUARD, useClass: SameOriginGuard },
  ],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
