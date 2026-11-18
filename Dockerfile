FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@12.3.4
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter reader deploy --prod /prod
RUN mkdir /data && chown 1000:1000 /data

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
RUN mkdir /data && chown node:node /data
ENV NODE_ENV=production
COPY --from=build /prod/node_modules ./node_modules
COPY --from=build /app/apps/reader/dist/server.js ./server.js
COPY --from=build /app/apps/reader/dist/public ./public
USER node
CMD ["node", "server.js"]
