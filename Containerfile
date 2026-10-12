FROM docker.io/library/node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
RUN mkdir /app/data && chown node:node /app/data
USER node
EXPOSE 8787
CMD ["node", "src/main.js"]
