FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node backend ./backend
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000
CMD ["node", "backend/app.js"]