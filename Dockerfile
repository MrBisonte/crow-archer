# One image serving the page and the socket. Any host that takes a Dockerfile
# and assigns PORT can run it, which is why the deploy target is not baked in.

FROM node:22-alpine AS build
WORKDIR /app
# Manifests first, so a dependency-free change reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist-server ./dist-server
# The client is served from here, and read relative to the working directory.
COPY --from=build /app/dist ./dist
# Documentation only. The host assigns the real port through PORT.
EXPOSE 8082
USER node
CMD ["node", "dist-server/index.js"]
