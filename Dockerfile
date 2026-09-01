FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .
ENV PORT=8080 BFBS_DATA_DIR=/app/data
EXPOSE 8080
CMD ["node", "server.js"]
