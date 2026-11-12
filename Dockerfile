FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 4100
ENV PORT=4100

CMD ["node", "server.js"]
