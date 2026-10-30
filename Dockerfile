FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY squeek-drop-frontend/squeek-drop ./squeek-drop-frontend/squeek-drop
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production DB_PATH=/data/squeek.sqlite
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "server/main.js"]
