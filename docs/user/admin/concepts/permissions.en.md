# Permissions per feature type

Every feature type has a `permissions` section in the project file. Anything not explicitly allowed is denied: when an entry is missing, nobody may do that action.

```yaml
permissions:
  see: { intern_notiz: [kontrolle] }
  visible_when: "self.zustaendig == actor.id || !('bauhof' in actor.roles)"
  create: [kontrolle]
  delete: [verwaltung]
  write: { vitalitaet: [kontrolle] }
```

- `see`, `create`, `delete` and `write` take `$all` (any actor, also one without roles) or a list of roles.
- `see` as a list or `$all`: only these roles see the features, with all their properties.
- `see` as a map of property to roles: every role sees the features; the listed properties are visible only to the listed roles, all other properties to everyone.
- `write` as a map: properties that are not listed cannot be changed by anyone.
- `visible_when` is an extra condition per feature (for example *only my own reports*). A feature is visible when the role may see it and the condition holds.
- *Only own entries*: `visible_when: "self.$created_by == actor.id"` shows each person only the entries they created. The system fields `self.$created_by` (who created the entry), `self.$created_at`, `self.$changed_at` (when it was created and last changed) and `self.$lifecycle` can be used in any condition. An entry created before this existed gets its creator from the run that created it.
- Deleting also requires that the role may see the feature.
