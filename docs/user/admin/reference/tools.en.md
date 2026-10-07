# Tools in a role's app

Each role lists the tools it has under `roles.<role>.app.tools`. A tool the role does not list does not exist for that role.

```yaml
roles:
  kontrolle:
    app:
      tools:
        search: { availability: active }
        measure: { availability: offered }
        photo: { settings: { maxEdge: 1600 } }
tools:
  search: { sources: [baum.befund] }
```

- **`availability: active`** (the default): the tool is on at first. The person may switch it off in their own settings.
- **`availability: offered`**: the tool is off at first. The person may switch it on in their own settings.
- There is no level that keeps a tool on for good.
- **Settings:** `tools.<key>` holds the settings for the whole project, `settings` inside a role's entry holds the settings for that role and wins over the project ones. A person can never change a setting; a tool may also offer **preferences**, which only the person changes (for example a unit), and the settings may give their starting value.
- **Checked at publish:** the shipped tools check their settings. An option the tool does not have, or a value that does not fit it, stops the publish and names the path (for example `tools.photo["maxEdge"]`). The photo tool takes `maxEdge` (a whole number from 16 to 16384), `quality` (above 0, at most 1) and `allowLocation` (true or false); the search tool takes `sources`; measure, draw and file take no settings.
