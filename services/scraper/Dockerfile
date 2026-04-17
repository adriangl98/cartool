# ── Stage 1: build ──────────────────────────────────────────────────────────
# Use a standard Node image to compile TypeScript; keep Playwright runtime
# separate so the builder stage stays lean.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci --ignore-scripts

COPY src/ ./src/
RUN npm run build

RUN npm prune --omit=dev

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
# The official Playwright image ships with Chromium (and its shared-lib deps)
# pre-installed for the version of @playwright/test bundled in the image.
FROM mcr.microsoft.com/playwright:v1.59.1-noble AS runtime

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# pwuser is the pre-created, non-root user in the Playwright base image.
# Ensure it owns the app directory.
RUN chown pwuser:pwuser /app

COPY --from=builder --chown=pwuser:pwuser /app/dist ./dist
COPY --from=builder --chown=pwuser:pwuser /app/node_modules ./node_modules
COPY --chown=pwuser:pwuser package.json ./

USER pwuser

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3003/health || exit 1

CMD ["node", "dist/index.js"]
