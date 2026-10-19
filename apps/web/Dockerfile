# syntax=docker/dockerfile:1
# Build context: repository root (docker build -f apps/web/Dockerfile .)

FROM node:22.22-alpine AS build
RUN npm install -g pnpm@9.15.9
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/config/package.json packages/config/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@diffsentinel/web..."

COPY packages/config packages/config
COPY apps/web apps/web
RUN pnpm --filter @diffsentinel/web build

# Runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
