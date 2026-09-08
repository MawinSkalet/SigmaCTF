FROM node:22-bookworm-slim
WORKDIR /app
COPY server.js ./
USER 10001:10001
EXPOSE 8080
CMD ["node", "server.js"]
