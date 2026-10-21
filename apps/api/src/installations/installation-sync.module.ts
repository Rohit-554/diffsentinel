import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { GitHubModule } from "../github/github.module";
import { InstallationSyncService } from "./installation-sync.service";

@Module({
  imports: [AuditModule, GitHubModule],
  providers: [InstallationSyncService],
  exports: [InstallationSyncService],
})
/** The GitHub → database sync used by sign-in; no HTTP routes. */
export class InstallationSyncModule {}
