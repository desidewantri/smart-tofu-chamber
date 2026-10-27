# Backend TOSCHA (Node/Express) untuk server produksi.
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY scripts ./scripts
USER node
EXPOSE 5000
CMD ["node", "src/server.js"]
