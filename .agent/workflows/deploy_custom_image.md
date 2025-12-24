---
description: Build and deploy custom listmonk image on remote server
---

# Deploy Manual (Remote Podman)

Since you are deploying to a remote server (`dev.sulopuis.to`) with Podman, follow these steps.

## 1. Sync and Build

We have created a script to sync your local code to the server and build the image there.

1.  Make the script executable:
    ```bash
    chmod +x deploy_dev.sh
    ```

2.  Run the script:
    ```bash
    ./deploy_dev.sh
    ```
    *This will sync files to `~/listmonk-custom` on the server and run `podman build`.*

## 2. Update Production (on Server)

After the build completes successfully, log in to your server:

```bash
ssh dst@dev.sulopuis.to
```

### If using Docker Compose / Podman Compose

1.  Navigate to your listmonk directory (where your `docker-compose.yml` is).
2.  Edit `docker-compose.yml`:
    ```yaml
    services:
      app:
        image: localhost/listmonk-custom:latest   # <--- Use the local image name
        # ...
    ```
3.  Restart:
    ```bash
    podman-compose up -d
    # or
    docker-compose up -d
    ```

### If using Systemd / Manual Podman Run

If you run listmonk directly with a `podman run` command or systemd unit, update the image reference in your script/unit file to `localhost/listmonk-custom:latest` and restart the service.

```bash
systemctl restart listmonk
```
