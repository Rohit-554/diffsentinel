import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { GitHubModule } from "../github/github.module";
import { InstallationsModule } from "../installations/installations.module";
import { AuthController } from "./auth.controller";
import { PendingSignInStore } from "./pending-sign-in.store";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

/** GitHub sign-in, sessions and the guard other modules use to require a session. */
@Module({
  imports: [AuditModule, GitHubModule, InstallationsModule],
  controllers: [AuthController],
  providers: [PendingSignInStore, SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
