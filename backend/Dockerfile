FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite database and sessions live here; mount a volume to persist them
ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "server.js"]
