FROM node:20-slim

# Install runtime dependencies for the Python extractor
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ffmpeg \
    tesseract-ocr \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m pip install --no-cache-dir --break-system-packages \
    "yt-dlp>=2025.1.1" \
    "youtube-transcript-api>=1.2.4" \
    "pypdf>=5.0.0" \
    "faster-whisper>=1.0" \
    "curl_cffi>=0.7"

WORKDIR /app

# Install all deps (including devDeps) to build
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Prune devDeps after build
RUN npm prune --omit=dev

# Copy Python scripts (ai-memory repo is cloned at runtime via GIT_DEPLOY_KEY_B64 + AI_MEMORY_REPO)
# The extract.ts shells out to run_pipeline.sh; path is resolved at runtime via AI_MEMORY_LOCAL_DIR

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/src/server.js"]
