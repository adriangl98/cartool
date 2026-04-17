# ── cartool db-migrator ─────────────────────────────────────────────────────
# Runs node-pg-migrate then exits (one-shot). Not a long-running service.
FROM node:22-alpine

WORKDIR /app

COPY package*.json node-pg-migrate.config.cjs ./
RUN npm ci --ignore-scripts

COPY migrations/ ./migrations/
COPY scripts/ ./scripts/
COPY seeds/ ./seeds/

# Run as non-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    chown -R appuser:appgroup /app
USER appuser

CMD ["npm", "run", "migrate:up"]
