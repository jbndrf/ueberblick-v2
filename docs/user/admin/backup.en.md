# Backups

All databases and uploaded files of your instance are continuously backed up into a folder on your server, for example a mounted NAS.

## Turn it on
1. Set the folder in `.env`: `BACKUP_DIR=/mnt/nas/ueberblick` (the folder must exist; mount a NAS on the server first).
2. Run `docker compose --profile backup up -d`. The `backup` service now runs next to the app (to stop it: `docker compose --profile backup stop backup`). Pass `--profile backup` on every later `docker compose up -d` too, otherwise the service is not started with it.

## Check that it works
- `docker compose --profile backup ps` shows `backup` as running.
- After about a minute the folder `BACKUP_DIR` holds the subfolders `databases`, `files` and `journal`.
- `docker compose --profile backup logs backup` shows lines with `"event":"config"` (the databases being backed up) and no lines with `problem`.
- **New projects** are picked up automatically, after about a minute at most.

## Restore
On the server, in the installation folder, with the app stopped:

```
docker compose --profile backup down
docker compose --profile backup run --rm backup restore
docker compose --profile backup up -d
```

If the `data` folder is not empty the command stops and changes nothing. With `restore --force` the existing content of `data` is replaced (only after the backup has been checked). Nothing else needs installing: the command runs in the backup image.

The command restores all databases and all files and re-applies erasures of personal data. It stops without publishing anything if the data folder is not empty, the erasure journal is missing or a database does not check out.

## What is backed up and for how long
- **Loss in the worst case:** at most a few seconds of input.
- **Retention:** 30 days (to be confirmed by your data-protection officer). You can go back to any state of the last 30 days.
- **Files:** photos and attachments are copied to the subfolder `files` every minute. When a file is deleted (for example by an erasure of personal data) it is removed there as well.
- Input that devices had not yet sent stays on the devices and syncs after the restore.
- **Testing:** your operator tests the restore regularly (at least monthly).

**Erased personal data stays erased.** When a person's data has been erased, a restore does not bring it back: your operator re-applies all erasures from the erasure journal before the restored database goes live. The operator keeps this journal outside the backup storage. **Limit of this protection:** an erasure that happened after the operator's last export of the erasure journal is not re-applied and would reappear after a restore. Operators must export the journal after every erasure and at least hourly. Older backups still contain the data until they expire, which is why the retention is limited.

**A failed restore changes nothing.** The command replaces the old data only after the backup is fully checked; if a check fails it changes nothing in the data folder and the server starts as usual. An interrupted restore may leave the folder `.restore-old` holding the old data: your operator inspects it and removes it, or the command with `--force` replaces it.
