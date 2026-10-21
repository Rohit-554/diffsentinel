import { type DynamicModule, Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "./config/config.module";
import type { AppConfig } from "./config/env";
import { HealthModule } from "./health/health.module";
import { InfraModule } from "./infra/infra.module";

@Module({})
export class AppModule {
  /** Builds the root module from config that main.ts has already validated. */
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(config), InfraModule, HealthModule, AuthModule],
    };
  }
}
