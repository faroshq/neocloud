# Build stage
FROM node:22-alpine AS builder

WORKDIR /build

# Install root workspace
COPY package.json ./
COPY app-shell/ app-shell/
COPY pilets/ pilets/

# Install dependencies and build
RUN npm install --workspaces
RUN cd app-shell && npm run build -- --type release --fresh

# Production stage — serve static files with nginx
FROM nginx:alpine

# SPA fallback: serve index.html for all /console/* routes
RUN printf 'server {\n\
    listen 4466;\n\
    root /usr/share/nginx/html;\n\
    location /console/ {\n\
        alias /usr/share/nginx/html/;\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
    location = / {\n\
        return 302 /console/;\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

COPY --from=builder /build/app-shell/dist/release/ /usr/share/nginx/html/

EXPOSE 4466

CMD ["nginx", "-g", "daemon off;"]
