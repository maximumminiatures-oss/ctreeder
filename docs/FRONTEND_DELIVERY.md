# Versioned frontend delivery

The public `/site/` HTML is never stored (`no-store`). It pins a complete frozen
JS/CSS/JSON snapshot with a same-origin `<base>` URL. Imports and relative data
requests stay in that snapshot even after history.replaceState changes the page
URL. Immutable snapshot and artwork responses have a one-year cache lifetime.
Account/session/API responses keep their existing private/no-store behavior.
This build changes static URL delivery, not gameplay rules or module boundaries.

## Build, verify and activate

From the repository root with Python 3.10 or later:

```sh
python scripts/build_versioned_site.py
python scripts/build_versioned_site.py --verify RELEASE_ID
python scripts/build_versioned_site.py --activate-release RELEASE_ID
```

`npm run build:site` builds and activates in one operation. Default input is
`S3_content`; dedicated output is `.frontend-build`, excluded from Git/Docker.
Build from a stable reviewed checkout. The builder checks the input twice,
validates relative module imports, hashes every output, and refuses to overwrite
an immutable release. It never includes account databases, secrets, saves,
backups, Clip Studio sources, or unused-assets. Do not deploy the asset archive.

A release ID hashes the complete public input graph and build recipe. Artwork
and fonts have a separate content-derived group ID, reused across code/data-only
updates. An artwork change invalidates that whole group; individual asset hashes
or bundling are possible later, after measurements. Public files are allowlisted;
add new public file types deliberately and extend tests.

The generated index is replaced atomically after all files verify. release.json
is informational; the HTML base is the authoritative release selection. Old
versioned tabs retain their code, data and artwork. Retain ALL old releases and
art groups: there is deliberately no automatic pruning. Legacy tabs opened
before versioned delivery cannot retroactively be pinned; refresh them once.
This pins public static files only. It does not version backend room commands;
server protocol/rule changes still need an explicit compatibility or upgrade plan.

## Native nginx / deployment

Use `deploy/nginx/ctreeder.com.conf` on this native-nginx host. Exact `/site/`
and `/site/release.json` locations serve the generated entry/pointer with no-store;
`/site/_releases/` and `/site/_assets/` serve frozen files. The old `/site/` alias
remains for legacy URLs. Security headers are preserved in every new block.
Immutable headers apply to successful responses, not missing-file errors.

Follow the protected-backup and checkout checks in DIGITALOCEAN_DEPLOYMENT.md.
After a reviewed source update, build without activation, verify the release,
smoke its direct `https://ctreeder.com/site/_releases/ID/` URL, then activate it.
On first installation add frozen routes before switching the root entry. Test
the exact trailing-slash entry URI on a loopback canary before public activation,
then smoke `/site/` itself immediately. A direct frozen URL alone is insufficient.
Use root plus try_files for the exact `/site/` file response: a file alias on a
trailing-slash URI can concatenate index.html twice and produce HTTP 500 even
when `nginx -t` succeeds. Test `nginx -t` before graceful reload. No app/container restart is needed for static
changes. Never start the compose nginx service on this host.

Check HTTPS `/`, `/site/`, `/healthz`, `/api/session`, all required artwork,
module/data requests, and browser console. Confirm immutable asset headers and
no-store session headers. Check an old tab and a new tab across activation.
Rollback with `--activate-release OLD_ID`; retain its files. A first-install
rollback restores the saved HTTP/2 nginx configuration, not the earlier HTTP/1
configuration. Never change live database or user saves for delivery tests.

## Reproducible checks

- `python -m pytest tests/test_frontend_delivery.py` checks deterministic IDs,
  rollback, missing imports, immutability, public allowlisting and art reuse.
- `python scripts/check_versioned_browser.py --output DIRECTORY` checks old/new tabs, URL changes,
  data coherence, rollback and private API cache policy using temporary fixtures.
- `scripts/preview_versioned_site.py` is a loopback-only comparison server.
- `scripts/measure_site_loading.py LABEL URL [--h1] [--warm-only]` records CDP
  1.6 Mbps / 150 ms runs. Set SD_MEASUREMENT_OUTPUT for artifact location.
  A real warm test primes a successful full-speed load first. Aborted requests
  do not count as successful startup and their partial bytes are absent from
  Resource Timing totals. The resource-byte total also excludes the main HTML;
  navigation transfer is recorded separately. Settled time is not an interaction
  or paint metric.

## November 20 rollout boundary

The first delivery rollout wrapped 4330375 unchanged. The follow-up reviewed hotfix
publishes only the supplied 648x432 floor, 45-second per-started-image deadline,
observable loading/retry, and lossless private-fog transport. The old 5.21 MB floor
is absent from new releases; old immutable releases retain their artwork for open
tabs. No broad local water, exploration-renderer, combat, treasure or autosave
changes are included in this narrow release.

## Lossless private exploration protocol

private-visibility.js and private_visibility.py own the gzip JSON envelope
sd-private-fog-gzip-v1. Coordinates, ring order, holes, route IDs and completion
flags are preserved exactly as in ordinary JSON; no rounding or simplification.
Compression runs at the multiplayer I/O boundary, never during movement/rendering.
The server keeps canonical raw private state and existing account quotas.

The wire limit remains 1 MiB. Decoded data is bounded to the existing 5 MiB world
JSON budget and all existing complexity, map-coordinate, route and ring checks
still apply. Base64 is split into <=12,000-character pieces for existing JSON
string limits. Decoders reject wrong lengths, invalid CRC/truncated or trailing
streams, wrong floor metadata, unknown formats and oversized output. Over-budget
inputs fail explicitly; they never erase or truncate saved exploration.

Only clients advertising X-ShadowSpawner-Visibility-Encoding receive encoded
private responses. Old clients keep raw responses and small raw requests remain
accepted. Hosting preserves supplied exact memory even with the legacy gameplay
normalizer; it is excluded from shared world-response visibility. Each viewer gets
only their private memory. Existing server-owned inactive-floor memories remain.

Private heartbeat/leave requests are serialized per room, preserving write order
through asynchronous compression and upload. The default room transfer budget is
30 seconds; exact-memory uploads receive at least that budget, including the
previous short leave upload. Caller cancellation remains supported. This does
not guarantee an upload after a browser is forcibly closed mid-transfer.

The reproduced 3,000-move fixture has 36,227 points. Its 1,420,500-byte validation
payload fits in 676,751 encoded bytes and decodes exactly. Firefox checks cover
hosting, heartbeat, leave/resume, Python/browser interoperability and guest
isolation. A deliberately failed first floor request recovers via Retry Artwork.
