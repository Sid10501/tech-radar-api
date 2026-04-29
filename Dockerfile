FROM node:20-slim

# Install runtime dependencies for the Python extractor
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    ffmpeg \
    git \
    openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install all deps (including devDeps) to build
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune devDeps after build
RUN npm prune --omit=dev

# Copy Python scripts (ai-memory repo is cloned at runtime via GIT_DEPLOY_KEY_B64 + AI_MEMORY_REPO)
# The extract.ts shells out to run_pipeline.sh; path is resolved at runtime via AI_MEMORY_LOCAL_DIR

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/src/server.js"]
