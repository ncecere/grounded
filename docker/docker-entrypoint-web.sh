#!/bin/sh
set -e

# Generate runtime config from environment variables
cat > /usr/share/nginx/html/config.js << EOF
window.__GROUNDED_CONFIG__ = {
  API_URL: "${API_URL:-}"
};
EOF

echo "Generated config.js with API_URL=${API_URL:-<empty>}"

# Start nginx
exec nginx -g 'daemon off;'
