# ctreeder.com working instructions

This is `maximumminiatures-oss/ctreeder`, the personal repository for the live
site. Read `docs/DIGITALOCEAN_DEPLOYMENT.md` before production work.

- Local checkout: `C:\SD_game\ctreeder`.
- The server retains `/opt/SD-Dungeon-Generator` for path compatibility, but its
  origin is `https://github.com/maximumminiatures-oss/ctreeder.git`.
- Current portfolio source: `portfolio/`. The older `S3_content/portfolio/`
  must not replace it. Game frontend and tables: `S3_content/`, at `/site/`.
- Keep database contents, saved games, environment secrets, TLS keys, and
  backups outside Git. Never print or upload production `.env` or dumps.
- Preserve Compose project `sd-dungeon-generator` and existing named volumes.
  Changing the project name can attach empty volumes. Never use `down -v` on
  production.
- Native nginx owns ports 80/443. Do not start the Compose nginx service on the
  host or replace the native configuration with the local Docker template.
- Push ctreeder.com work to this personal repository. Group-repository links
  in historical documents are provenance, not deployment targets. Do not use
  legacy AWS deployment scripts for ctreeder.com.
- Preserve unrelated working-tree changes. A Git push alone does not deploy.

## UI conventions

Do not use the `JBlack` display font for new interface text unless requested.
Default to `"Times New Roman", Georgia, serif`, matching the GEAR heading.

## Verification

Run checks appropriate to the change: `pytest -q --ignore=tests/e2e` for backend
tests and `npm test` for runtime tests. Database fixtures recreate tables, so
tests must use an isolated database and never production. Preview at `/site/`.
Before deployment, verify a protected backup and retain a rollback image.
Afterward, check the changed functionality and service health.
