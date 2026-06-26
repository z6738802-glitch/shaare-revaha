FROM node:20-alpine
WORKDIR /app
COPY server/ ./
RUN npm install --production
EXPOSE 3000
CMD ["node", "src/index.js"]
