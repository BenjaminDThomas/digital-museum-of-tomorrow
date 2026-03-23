FROM nginx:alpine

# Copy the site files to nginx's serve directory
COPY . /usr/share/nginx/html

# Custom nginx config for clean routing and security headers
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
