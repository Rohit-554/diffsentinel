# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/api/Dockerfile .)

FROM node:22.22-alpine AS build
# openssl is required by the Prisma query engine on Alpine.
RUN apk add --no-cache openssl && npm install -g pnpm@9.15.9
WORKDIR /repo

# Install from the lockfile using only the manifests, so this layer is cached
# until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@diffsentinel/api..."

COPY packages/config packages/config
COPY apps/api apps/api
RUN pnpm --filter @diffsentinel/api prisma:generate \
 && pnpm --filter @diffsentinel/api build \
 && pnpm --filter @diffsentinel/api deploy --prod /out
# The production install in /out has its own @prisma/client, so generate into it.
RUN cd /out && /repo/apps/api/node_modules/.bin/prisma generate --schema prisma/schema.prisma

FROM node:22.22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/prisma ./prisma
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
