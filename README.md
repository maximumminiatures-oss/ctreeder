# ctreeder.com

Personal source repository for **https://ctreeder.com**: Charles Reeder's
portfolio, illustration gallery, world map, MCC generator, and ShadowSpawner
application at `/site/`.

This is the source for the existing DigitalOcean deployment. It includes the
actual live portfolio, not the older college version in `S3_content/portfolio/`.

| Location | Contents |
| --- | --- |
| `portfolio/` | Current portfolio, images, illustrations, world map, MCC generator, and code samples |
| `S3_content/` | Game frontend, artwork, and monster/trap JSON tables; the name is historical and does not require AWS |
| Root Python modules, `templates/`, `static/` | Flask APIs, accounts, saved games, multiplayer, and character import |
| Both `docker-compose*.yml` files and `Dockerfile` | Application services and current DigitalOcean settings |
| `deploy/nginx/ctreeder.com.conf` | Native nginx configuration |
| `tests/`, `.github/workflows/test.yml` | Backend, runtime, security, and CI checks |
| `docs/DIGITALOCEAN_DEPLOYMENT.md` | Current deployment and backup instructions |
| `PROVENANCE.md`, `docs/history/` | Original attribution and historical deployment notes |

## Private data

Public site content and application source belong here. Account records,
password hashes, saved games, and other private database content remain in the
existing PostgreSQL volume on DigitalOcean. Redis persistence, production
secrets, TLS private keys, database dumps, and protected backups stay outside
Git. `.env.example` contains configuration placeholders, not real credentials.

## Development and verification

Use Python 3.12+ and Node 24+. Install `requirements.txt` in a virtual environment
and run `npm ci`. For a local preview, use `python scripts/dev_preview.py` with
its isolated development database. Open `/site/` for the game.

```sh
pytest -q --ignore=tests/e2e
npm test
python scripts/check_tracked_secrets.py
```

CI checks SQLite and PostgreSQL and reports the required `test` summary only
when both succeed. Pushing runs CI; it does not deploy the website. Follow the
deployment runbook to update production.

ShadowSpawner originated in the ShadowDarklings course project. Its Git history
and attribution are retained. This personal repository now supplies ctreeder.com;
building, running, and deploying do not require access to the group repository.
