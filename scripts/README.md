# Scripts

This directory contains utility scripts for listmonk.

## WordPress RSS to Listmonk

`wp-rss-to-listmonk.py` is a Python script that fetches a WordPress RSS feed and creates draft campaigns in listmonk for new posts.

### Setup

1.  **Install dependencies**:
    This script is designed to be run with `uv`.
    ```bash
    uv run scripts/wp-rss-to-listmonk.py
    ```
    Alternatively, install requirements manually:
    ```bash
    pip install feedparser requests python-dotenv
    ```

2.  **Configure**:
    Copy `.env.rss.sample` to `.env` and fill in your listmonk and RSS feed details.
    ```bash
    cp scripts/.env.rss.sample .env
    ```
    The listmonk credential in `.env` should be an API user/token, not your admin/dashboard password. Create it in the listmonk UI under `Admin → Users`, then copy that API username/token into the environment file.

3.  **Run**:
    ```bash
    uv run scripts/wp-rss-to-listmonk.py
    ```

### Automation

You can run this script on a cron job to periodically fetch new posts:

```bash
# Every hour
0 * * * * cd /path/to/listmonk && /usr/local/bin/uv run scripts/wp-rss-to-listmonk.py >> /var/log/listmonk-rss.log 2>&1
```
