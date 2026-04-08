# /// script
# requires-python = ">=3.9"
# dependencies = [
#     "feedparser",
#     "requests",
#     "python-dotenv",
# ]
# ///

import os
import json
import logging
import feedparser
import requests
from dotenv import load_dotenv

# Configure logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

LISTMONK_URL = os.getenv("LISTMONK_URL", "http://localhost:9000")
LISTMONK_USER = os.getenv("LISTMONK_USER", "admin")
LISTMONK_PASS = os.getenv("LISTMONK_PASS", "listmonk")
RSS_FEED_URL = os.getenv("RSS_FEED_URL")
LIST_ID = int(os.getenv("LIST_ID", "1"))
STATE_FILE = os.getenv("STATE_FILE", "rss_state.json")


def load_state():
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading state: {e}")
    return {"processed_ids": []}


def save_state(state):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(state, f, indent=4)
    except Exception as e:
        logger.error(f"Error saving state: {e}")


def create_campaign(title, body, list_ids):
    url = f"{LISTMONK_URL}/api/campaigns"
    data = {
        "name": title,
        "subject": title,
        "lists": list_ids,
        "type": "regular",
        "content_type": "html",
        "body": body,
        "messenger": "email",
    }

    response = requests.post(url, json=data, auth=(LISTMONK_USER, LISTMONK_PASS), timeout=10)

    if response.status_code == 200:
        logger.info(f"Successfully created campaign: {title}")
        return response.json()
    else:
        logger.error(
            f"Failed to create campaign: {response.status_code} - {response.text}"
        )
        return None


def main():
    if not RSS_FEED_URL:
        logger.error("RSS_FEED_URL is not set.")
        return

    logger.info(f"Fetching RSS feed: {RSS_FEED_URL}")
    feed = feedparser.parse(RSS_FEED_URL)
    if feed.bozo:
        logger.error(f"Error parsing RSS feed: {feed.bozo_exception}")
        return

    state = load_state()
    processed_ids = set(state.get("processed_ids", []))

    new_posts = []
    for entry in feed.entries:
        post_id = entry.get("id") or entry.get("link")
        if post_id and post_id not in processed_ids:
            new_posts.append(entry)

    if not new_posts:
        logger.info("No new posts found.")
        return

    logger.info(f"Found {len(new_posts)} new posts.")

    for post in reversed(new_posts):  # Process oldest first
        title = post.get("title", "No Title")
        # WordPress RSS usually has 'content' or 'summary'
        content = post.get("content")
        body = (
            content[0].get("value") if content and isinstance(content, list)
            else post.get("summary")
            or post.get("description")
        )
        link = post.get("link")

        # Add a link to the original post if body is short or missing
        if body:
            body += f'<p><a href="{link}">Read more...</a></p>'
        else:
            body = f'<p>New blog post: <a href="{link}">{title}</a></p>'

        result = create_campaign(title, body, [LIST_ID])
        if result:
            post_id = post.get("id") or post.get("link")
            processed_ids.add(post_id)
            state["processed_ids"] = list(processed_ids)
            save_state(state)


if __name__ == "__main__":
    main()
