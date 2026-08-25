FROM node:22-bookworm-slim

WORKDIR /app

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
RUN npm ci

COPY . .

CMD ["npm", "test", "--", "--runInBand"]
