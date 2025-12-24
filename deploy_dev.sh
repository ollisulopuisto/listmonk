#!/bin/bash

# Configuration
SERVER="dev.sulopuis.to"
USER="dst" # Change if different
REMOTE_DIR="/home/dst/projects/listmonk"
IMAGE_NAME="listmonk-custom"

echo "🚀 Deploying to $SERVER..."

# 1. Sync files to the server (excluding heavy/unnecessary files)
echo "📂 Syncing files..."
rsync -avz --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude 'frontend/node_modules' \
    --exclude 'frontend/dist' \
    --exclude 'frontend/email-builder/node_modules' \
    . "$USER@$SERVER:$REMOTE_DIR"

# 2. Build the image on the server using Podman
echo "🔨 Building image on server..."
ssh "$USER@$SERVER" "cd $REMOTE_DIR && podman build -f Dockerfile.local -t $IMAGE_NAME ."

# 3. Instructions for running
echo "✅ Build complete!"
echo ""
echo "To test run on the server:"
echo "  ssh $USER@$SERVER"
echo "  podman run --rm -p 9000:9000 $IMAGE_NAME"
echo ""
echo "To update your production service:"
echo "  1. Edit your docker-compose.yml (or systemd unit) on the server."
echo "  2. Change image to: localhost/$IMAGE_NAME:latest"
echo "  3. Restart the service."
