import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { GitHubModule } from "../github/github.module";
import { InstallationSyncService } from "./installation-sync.service";

@Module({
  imports: [AuditModule, GitHubModule],
  providers: [InstallationSyncService],
  exports: [InstallationSyncService],
})
export class InstallationsModule {}
