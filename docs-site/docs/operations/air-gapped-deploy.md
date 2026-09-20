---
sidebar_position: 7
title: "Air-gapped Deploy"
---

# 22 - Deploying to an air-gapped host

For hosts with no route to a registry, where images are built elsewhere and
carried over as tarballs. If your host can pull from a registry, use
[16 - Docker Deployment](16-deployment-docker.md) instead.

---

## The one rule

**Deploy an image built from a commit on `main`. Never from a working tree.**

An image built from uncommitted changes works — that is exactly what makes it
dangerous. The fix is live, nobody can reproduce it, and the next person who
deploys from `main` silently reverts it. Their deploy looks clean: green build,
healthy container, no errors. The regression only shows up later, in behaviour,
with no diff to point at.

This is not hypothetical. On 2026-09-20 this repository's production host ran
three fixes that existed in no branch, commit or PR:

- a patched dependency, without which **every** image, video and document send
  failed — while the API still answered `201`, so nothing looked wrong
- a page-size cap on two endpoints that could otherwise load gigabytes of
  inline media into the heap
- a route that served uploaded media, without which every media send through an
  upload fetched the API's own 404 body and handed it to the recipient

A routine deploy from `main` would have undone all three. It was caught only
because someone checked what the running image actually contained before
replacing it.

If a fix is urgent enough to hand-deploy, it is urgent enough to open a PR for
in the same hour. Deploy the image you built from the working tree if you must —
then get the branch up the same day.

---

## Before you deploy: check what is actually running

Do this first, every time. It costs seconds and it is the check that catches the
problem above.

```bash
# Pick a string that exists only because of the change you expect to be there.
docker exec <api-container> sh -c \
  "grep -rl 'someMarkerFromYourFix' /app/apps/api/dist | wc -l"
```

If the running image contains something your image does not, **stop**. Find out
what it is and get it into `main` before going any further.

For a patched dependency, check the installed copy, not the `.patch` file:

```bash
docker exec <api-container> sh -c \
  "grep -rl 'markerFromThePatch' /app/node_modules/.pnpm/<package>*/ | wc -l"
```

pnpm stores a patched package under a directory whose name embeds a peer hash,
so a dependency bump can drop a patch while the `.patch` file sits untouched in
git. "It is committed" and "it is applied" are different claims.

---

## 1. Build

Use the `export-image.yml` workflow (`workflow_dispatch`, inputs `service` and
`tag`). It builds on a native amd64 runner and uploads a `.tar.gz` artifact.

Build from `main`, not from a branch — see the rule above.

## 2. Download

Artifact download URLs are **signed and short-lived**. Resolve each one
immediately before you use it:

```bash
url=$(curl -s -o /dev/null -w '%{redirect_url}' \
      -H "Authorization: Bearer $(gh auth token)" \
      "https://api.github.com/repos/<owner>/<repo>/actions/artifacts/<id>/zip")
curl -s -o image.zip "$url"
```

Resolving several URLs up front and then downloading in sequence does not work:
by the time the second download starts, its URL has expired. The failure is
quiet — you get a small XML error document with a `.zip` name, which only looks
wrong if you check the size.

Generate a checksum as soon as the file lands:

```bash
sha256sum multiwa-api-<tag>.tar.gz > multiwa-api-<tag>.tar.gz.sha256
```

## 3. Transfer

**`scp` can truncate a large file and still exit `0`.** On a slow or unstable
link this is common, not rare. Always transfer the `.sha256` sibling too, and
always verify on the far side before loading anything.

To resume an interrupted transfer:

```bash
rsync -e "ssh <opts>" --partial --append <file> <user>@<host>:<dir>/
```

> macOS ships openrsync, which has no `--append-verify` and no
> `--human-readable`. `--append` plus a server-side checksum is the equivalent.

### If the host runs OpenSSH 9.8 or newer

`PerSourcePenalties` is on by default. It tracks failures per source address and
**every retry adds to the penalty**, so retrying on a timer makes it worse, not
better. Check with `sudo sshd -T | grep -i penalt`.

Two things make it a non-issue:

```bash
# 1. One failed connect otherwise burns THREE auth attempts.
-o NumberOfPasswordPrompts=1

# 2. Run the whole session over ONE connection; scp and rsync reuse it
#    with no new authentication at all.
-o ControlMaster=auto -o ControlPath=~/.ssh/cm/<host> -o ControlPersist=4h
```

`sudo systemctl restart ssh` clears the in-memory penalty table if you are
already locked out and have another way in.

## 4. Deploy

Run the deploy detached on the host, logging to a file, so a dropped connection
cannot kill it midway:

```bash
sudo sh -c 'nohup bash <deploy-script> > <log> 2>&1 &'
```

A deploy script for this path should refuse to continue unless:

| gate | why |
|---|---|
| enough free disk | loading an image needs room for the tar *and* the layers |
| the tar has a `.sha256` sibling, and it matches | catches a truncated transfer |
| the expected engine host is set | recreating the wrong service drops a live session |
| **the image contains every fix it should** | catches the regression this page opens with |
| a rollback tag is written first | before anything is recreated |

The content gate is the one people skip. It is a `grep` inside the image for a
marker per change, run **before** the recreate. If a marker is missing, restore
the tag and stop — nothing has been touched yet.

Order matters: recreate the service that holds no session first. If it goes
wrong, the one that matters is still untouched.

## 5. Verify

```bash
docker compose ps                      # healthy, and a fresh start time
docker exec <api> sh -c 'head -c 120 /proc/1/cmdline | tr "\0" " "'
docker logs <api> --since 5m 2>&1 | grep -cE '"level":(50|60)'
```

Then check the thing the deploy was *for* — a log line that should now appear, a
failure rate that should now drop. "Healthy" only means the process started.

A reverse proxy caches the upstream address from its own startup, so reload it
after recreating a service behind it:

```bash
docker exec <proxy> nginx -s reload
```

---

## Rollback

Tag before you load, so rollback needs no transfer:

```bash
docker tag multiwa-api:rollback-<stamp> multiwa-api:wagw
docker compose up -d --no-deps --no-build --force-recreate api
```

Keep the tags, not the tarballs. A tarball is a copy of something you already
have; the tag is the thing `compose` actually resolves. Old rollback tags are
also the main reason disk fills up on a host like this — `docker image prune`
frees nothing while every old build still carries a tag.
