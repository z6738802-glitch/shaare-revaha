FROM node:20-alpine
WORKDIR /app
COPY server/package*.json ./
RUN npm install --production
COPY server/src ./src
EXPOSE 3000
CMD ["node", "src/index.js"]
