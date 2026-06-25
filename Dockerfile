FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src
COPY README.md ./

RUN mkdir -p /app/data

ENV NODE_ENV=production

CMD ["npm", "start"]
