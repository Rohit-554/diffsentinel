import "reflect-metadata";
import { ConsoleLogger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { configureApp } from "./app.setup";
import { type AppConfig, ConfigValidationError, parseEnv } from "./config/env";

function loadConfig(): AppConfig {
  try {
    return parseEnv(process.env);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      // Exit before opening the port. The message names variables, not values.
      new ConsoleLogger({ json: true }).fatal(err.message, "Config");
      process.exit(1);
    }
    throw err;
  }
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new ConsoleLogger({ json: true, logLevels: config.logLevels });

  const app = await NestFactory.create(AppModule.register(config), { logger });
  configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.port, "0.0.0.0");
  logger.log(`API listening on port ${config.port}`, "Bootstrap");
}

void bootstrap();
