import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AuthzModule } from "../authz/authz.module";
import { InstallationsController } from "./installations.controller";

/** Dashboard reads of installations and repositories. */
@Module({
  imports: [AuthModule, AuthzModule],
  controllers: [InstallationsController],
})
export class InstallationsModule {}
