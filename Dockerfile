FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.3.4
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter api deploy --prod /runtime-api

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production
COPY --from=build /runtime-api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./
COPY --from=build /app/apps/web/dist ./public
USER node
CMD ["node", "server.js"]
