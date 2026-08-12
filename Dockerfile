FROM node:20-slim

# Needed for better-sqlite3 native build + tzdata for correct local time in cron
RUN apt-get update && apt-get install -y python3 make g++ tzdata && rm -rf /var/lib/apt/lists/*

ENV TZ=America/Detroit

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data/uploads

EXPOSE 3040

CMD ["node", "server.js"]
