FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000 STORAGE_DIR=/storage NODE_ENV=production
VOLUME /storage
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://127.0.0.1:3000/api/settings >/dev/null || exit 1
CMD ["node", "server.js"]
