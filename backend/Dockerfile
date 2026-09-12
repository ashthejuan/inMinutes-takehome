FROM node:20-slim

# better-sqlite3 needs native build tools
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
