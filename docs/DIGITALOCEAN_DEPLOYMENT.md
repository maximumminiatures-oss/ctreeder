# ctreeder.com DigitalOcean deployment

## Current layout

- Repository: `https://github.com/maximumminiatures-oss/ctreeder.git`.
- Local checkout: `C:\SD_game\ctreeder`.
- Host: `root@157.230.143.58`, droplet `ctr-portfolio-sd`.
- Server checkout: `/opt/SD-Dungeon-Generator`, branch `main`. The legacy path
  preserves existing service and volume paths; origin is the personal repo.
- Compose project: `sd-dungeon-generator`, explicitly set in the base file.
- Portfolio: `/opt/SD-Dungeon-Generator/portfolio/`.
- Game: `/opt/SD-Dungeon-Generator/S3_content/`, served at `/site/`.
- Flask: Docker maps port 8000 only on `127.0.0.1`.
- Native nginx: `/etc/nginx/sites-enabled/ctreeder.com`; tracked source is
  `deploy/nginx/ctreeder.com.conf`. Preserve existing Certbot paths and TLS.

`/var/www/ctreeder.com/html` remains as a rollback copy after migration, but is
no longer the canonical public root. The old AWS host and group GitHub repo
are not deployment targets.

## Private state

Production `.env` stays on the host. PostgreSQL and Redis retain their existing
Docker volumes. Never commit database dumps, user records, saved games, password
hashes, real credentials, session secrets, private keys, or backups. Use mode 700
for protected backup directories and mode 600 for files. Verify database dumps
using `pg_restore --list`.

Preserve the `sd_owner` and `sd_app` roles, passwords, session secret, production
override values, memory/CPU/process limits, swap, and browser sandbox. The
importer receives no database secrets and exposes no host port.

## Updates

1. Work in the personal repo. Review the diff, test, scan staged files for
   secrets, push to the personal remote, and verify CI.
2. On the host, verify the revision, remote, tracked/untracked changes, service
   health, container IDs/images, disk, memory, and relevant logs. Preserve any
   unexpected changes.
3. Make a protected database backup with `pg_dump -U sd_owner -Fc app` inside
   the existing database container and verify it. Back up `.env`, Compose files,
   native nginx, and portfolio; retain the old app image.
4. In `/opt/SD-Dungeon-Generator`, fetch `origin main` and fast-forward to the
   exact reviewed revision. Never reset the checkout or overwrite `.env`.
5. Validate Compose without printing interpolated secrets:

   ```sh
   docker compose -p sd-dungeon-generator -f docker-compose.yml -f docker-compose.digitalocean.yml config --quiet
   ```

6. Portfolio and game-static updates are served directly from the checkout and
   need no app restart. For Python/runtime changes, replace only the app:

   ```sh
   docker compose -p sd-dungeon-generator -f docker-compose.yml -f docker-compose.digitalocean.yml build app
   docker compose -p sd-dungeon-generator -f docker-compose.yml -f docker-compose.digitalocean.yml up -d --no-deps --no-build --wait --wait-timeout 150 app
   ```

   Rebuild/replace the importer separately only if it changed. Database
   migrations are a deliberate separate step when schemas change. Do not start
   the Compose nginx service on this host.
7. For nginx changes, retain a rollback copy, install the reviewed tracked
   configuration, run `nginx -t`, and reload gracefully after validation.
8. Check the changed functionality, public HTTPS pages, `/api/session`, and
   `/healthz`. Table changes require all ten monster tables and traps to match
   the API. Importer/multiplayer changes require appropriate anonymous/host/guest
   flows with disposable fixtures. Never delete real saved games for testing.
9. Verify service health, protected settings, container/volume identity, and
   that no unintended files or services changed.

## Repository migration

Imported history through `bebe7a9`; the live runtime before migration was
`65eb5f2`. The intervening changes are test/CI-only. Public portfolio files were
exported directly from the server. The monster/trap API already uses local JSON.

Protected backup: `/root/ctreeder-repo-migration-backup-20260924`.
Rollback image: `ctreeder:pre-repo-migration-20260924`.
Migration preserves running containers and database volumes. Restore the saved
nginx configuration and Git remote config to roll back; the prior static root
remains in `/var/www/ctreeder.com/html`.

Earlier release history: `docs/history/DIGITALOCEAN_RELEASES_BEFORE_MIGRATION.md`.
