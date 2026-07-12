FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY dist ./dist
COPY README.md ./

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["npm", "start"]
