# Stage 1: Build TypeScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-slim
WORKDIR /app

# Install Python for inspect eval CLI
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Copy eval-engine (benchmarks, Python packages, etc.)
COPY eval-engine ./eval-engine

EXPOSE 3002
ENV NODE_ENV=production
ENV SERVER_PORT=3002
CMD ["node", "dist/index.js"]
