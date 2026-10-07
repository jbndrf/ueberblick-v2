# When a run is refused

The app checks each task on your device and again on the server. If a run is refused, you see one plain sentence saying why, in your language, in the form, in the list of pending changes and above an entry. The sentence has no code. When the refusal is about one field, a second line names it ("Field: Height"). If your device itself refuses the change, a red box "Not possible" with the reason appears above the form; nothing was saved, the form stays open with your entries, **Dismiss** hides the box. If the server refuses later, the change stays on your device with its values: at the feature and under Settings, Profile, "Pending changes" you see the reason, **Send again** and **Discard**.

| What you read | What you can do |
|---|---|
| The entry or task no longer exists. | Reopen the map and check the entry. |
| This entry is archived or deleted. | Ask an admin to restore it, or start a new entry. |
| This task is not available in the entry's current state. | Reopen the entry and check which tasks are offered. |
| You are not allowed to make this change. | Ask the administration whether your role should run the task. |
| You are not allowed to change this field. | Leave the field as it is. |
| You are not allowed to see this property. | Ask the administration whether your role may see the property. |
| This property does not exist. | Tell the administration. |
| A required field is missing. | Fill it in and send again (a translated text with no content in any language counts as empty). |
| A value is invalid. | Adjust the value. |
| The change is incomplete and was not applied. | Check the entries in the form (after a refusal by the server: discard the refused change and do the task again). |
| A related entry no longer exists. | Check the location of the entry. |
| The task does not fit this entry. | Start the task from the right entry. |
| A location is missing. | Set the location. |
| You've reached your limit of entries. | Ask the administration for a higher limit. |
| The change sets off too many follow-up changes and was not applied. | Tell the administration. |
| The change affects too many entries at once and was not applied. | Tell the administration. |
| Based on a refused change. | Fix the refused change first. |
| The file was damaged during upload. / The file was not uploaded. Please send it again. | Send again. |
| The file is too large. | Pick a smaller file. |
| The file is no longer on this device. Please pick it again. | Pick the file again. |
| The import has no coordinate reference system. | Tell the administration. |

## Follow-up change refused

If you created a feature offline, then made further changes to it, and the server refuses the creation, the feature disappears from the map. The later changes stand in Settings, Profile, "Pending changes" with the mark "Follow-up change refused". The text begins with "Based on a refused change." and then gives the reason of the refused change. They are not sent. **Discard** removes them, **Send again** queues them anew. The title of such a row does not jump to the map while the feature is not on the device.

A refusal you do not know yet (for example from a newer server) reads "The change was not applied."

When a run is refused, none of its changes are kept: a run is accepted completely or not at all.
