# Time-based automatic actions

An automatic action can react to the clock instead of an entry. These actions run **only on the server**, never on the device. An automatic action is an `auto` entry of the task it runs. When it fires, a run by the actor `system` is made for that task. It goes through the same checks as any other run, so the task should allow `actor.kind == 'system'`.

## After a date (`elapsed`)

```yaml
tasks:
  system_faellig:
    on: baum
    when: "actor.kind == 'system'"
    auto:
      kontrolle_wird_faellig:
        elapsed: { from: self.faellig_am, offset: "-days(14)" }
        when: "self.stage != 'erledigt' && self.kontrolle_faellig == false"
```

- The action is due at `from` plus `after` plus `offset` (`after` and `offset` are spans such as `days(30)` or `months(1)`).
- `self` is the feature of the task the entry sits in. The action is scheduled for each feature of that kind on its own.
- The due time is recalculated when a feature is created or when a property that appears in `from`, `after` or `offset` changes. Other changes leave it alone. A change to a *related* feature or to a project input (`inputs.*`) does not recalculate it either; that happens when the feature itself changes, or when the configuration is next deployed.
- If `from` is empty or the feature is archived or deleted, there is no due time.
- A due time fires **exactly once**, at the first pass of the server after that moment (also after an outage). The server looks every 30 seconds (`TIMERS_INTERVAL_S`). After a configuration is deployed the server reschedules the due times of all existing features. Whether the action then really runs is decided by `when` at that moment.
- A plain date means 00:00 UTC.
- The project file is checked when you save it: `from` must be a date or time, `after` and `offset` must be spans. A mistake is shown at the exact line, for example `tasks.system_faellig.auto.kontrolle_wird_faellig.elapsed.offset`.

## On a schedule (`schedule`)

```yaml
tasks:
  nachtlauf:
    on: $none
    when: "actor.kind == 'system'"
    auto:
      nachts:
        schedule: "0 6 * * *"        # daily at 06:00 UTC
```

Five fields: minute, hour, day of month, month, day of week (0 and 7 = Sunday). `*`, numbers, ranges (`9-17`), lists (`1,15`) and steps (`*/15`) are allowed. If day of month and day of week are both set, either one is enough. After a server outage the action runs once, not once per missed time.

A cron the parser cannot read (for example `61 6 * * *`) is **refused at publish**: the error names `tasks.<task>.auto.<name>.schedule` and the position of the fault. Such an action never reaches the server.

If a schedule finds no time within about eight years (for example `0 0 31 2 *`, 31 February), the Versions view (plan step, block **Warnings**, shown above the changes) and the result of a deploy show a **warning** with the path `tasks.<task>.auto.<name>.schedule`. The configuration is still published, but the action never runs. The server also writes one warning line to the log per automatic action and configuration version (`timer.dropped`).

### Only if idle ≥ days (`idle`)

```yaml
tasks:
  remind:
    on: baum                         # a task offered on the Objektart
    when: "actor.kind == 'system'"
    auto:
      remind_resting:
        schedule: "0 2 * * *"
        idle: days(30)
```

With `idle` the schedule does not fire once. At every cron time it visits **each Objekt** of the task's Objektart and fires only for those last changed at least that long ago (here 30 days). The entry's `when` is checked per Objekt (`self` is the Objekt). The server works a large Objektart off in pages of 50 Objekte (at most 1000 per automatic action per pass, at most 40 seconds) and resumes at the next pass; an Objekt that fails does not hold up the others; a new cron time does not start a second sweep while one is running. A fired run changes the Objekt, so it is only picked up again after another idle period.

In the editor of the automatic action the field **Only if idle ≥ days** sits under the cron on the **Schedule** trigger. Empty or 0 means: every Objekt (`idle: days(0)`). A `schedule` on a task offered on an Objektart always needs `idle` (otherwise it is refused when you save with `auto_schedule_without_idle`); a task offered on no Objektart cannot have `idle` (`tasks.<task>.auto.<name>.idle`). Above it, **In stage** limits the action to objects that are in that stage ("Any stage" = all).
