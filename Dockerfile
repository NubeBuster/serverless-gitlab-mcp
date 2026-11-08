FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
ENV PORT=8787
EXPOSE 8787
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8787/health || exit 1
USER node
CMD ["node", "server.js"]
