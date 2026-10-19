import { type INestApplication, VersioningType } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

/** HTTP setup shared by main.ts and the e2e tests: /api/v1 routes and OpenAPI docs. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("DiffSentinel API")
      .setDescription("HTTP API for the DiffSentinel pull request review platform.")
      .setVersion("v1")
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);
}
