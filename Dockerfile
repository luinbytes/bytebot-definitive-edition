FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=640
ENV DATABASE_URL=/app/data/sqlite.db

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        espeak-ng=1.51+dfsg-10+deb12u2 \
        ffmpeg=7:5.1.9-0+deb12u1 \
        tesseract-ocr=5.3.0-2 \
    && espeak-ng --version | grep -q '1\.51' \
    && ffmpeg -version | grep -q '^ffmpeg version 5\.1\.9' \
    && tesseract --version | grep -q '^tesseract 5\.3\.0' \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .
RUN mkdir -p /app/data /app/logs \
    && touch /app/.command-cache.json \
    && chown -R node:node /app/data /app/logs /app/.command-cache.json

VOLUME ["/app/data", "/app/logs"]
USER node
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=45s --retries=3 CMD ["node", "./scripts/healthcheck.js"]
CMD ["npm", "start"]
