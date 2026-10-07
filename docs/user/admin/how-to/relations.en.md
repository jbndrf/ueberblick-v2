# Manage relations

The **Relations** page (sidebar, under the project) says which feature types belong together, for example *an inspection belongs to a tree*. The **tree** is the **parent feature type**, the **inspection** the **child feature type**. Each relation is a row in a list.

## The list

Per row: the relation's **name**, below it parent → child, badges for the **attachment** (**Enforced** or **Optional**) and the **multiplicity** (**Single** or **Multiple**) and, when the relation comes from the template, the badge **Template**. On the right are the pencil (**Edit relation**) and the bin (**Delete relation**). With no relations the page shows **No relations yet**.

## Create a relation

1. Open **Create relation**.
2. Enter a **Name**, for example *Inspections*. The name appears on the parent feature as the list of its child features.
3. Choose the **Parent feature type** and the **Child feature type**. They must differ.
4. Choose the **Multiplicity**: **Single** (one child per parent) or **Multiple**.
5. Choose the **Attachment**: **Enforced** (child objects can only be created from the parent object) or **Optional** (also creatable standalone; linkable at creation).
6. Choose what happens **when the parent object is deleted**: **Delete children**, **Detach children** (the default) or **Block deletion**.
7. Choose **Geometry on spawn** (see below). If the child feature type has no geometry of its own, **Inherit from parent** is preselected.
8. **Create**.

The relation goes into the project file's **draft**: the child feature type gets a reference field to the parent feature type, and the parent feature type gets the list of its children. The publish bar shows the change; it is live with the next **Publish**. If the project file refuses the change (for example because a rule reads the list differently), the dialog stays open and names the reason.

## Attachment and deletion: visible tasks

The two selects are not a hidden setting. They are written as ordinary tasks and steps in the builder, named after the relation, where you can look at and change them like anything else:

- **Attachment.** The task **Create** *name* on the parent feature type creates a child object and sets its parent. **Enforced** makes the child's reference field required, so a child without a parent is refused. **Optional** leaves the field free. The task's form stays empty until you add fields in the builder.
- **Delete children.** The parent feature type's delete task first deletes the child objects and then the parent, in one run. If the person running it may not delete even one child, the whole run is refused and nothing changes. A step may name at most 100 children.
- **Detach children.** The delete task first clears the reference field on the children. The same all-or-nothing rule applies: if the person may not change a child, everything is refused.
- **Block deletion.** The delete task is only available while the parent object has no children.

If the parent feature type has no delete task yet (a task whose step sets the lifecycle to **deleted**), **Delete children** and **Block deletion** add one (**Delete**); with **Detach children** there is nothing to do while nothing can be deleted.

## Edit

The pencil opens the same dialog with the current values; attachment and deletion are read back from the tasks and steps. Pick another parent or child feature type and the reference field moves with its tasks and steps. Saving the same choice again changes nothing: the entries are rewritten, never doubled. If you rename the relation, the generated task's label follows unless you changed it yourself.

## Delete

**Delete relation** asks first. The dialog says how many (active) features of the child feature type are linked to a parent (exact, however many), and which places in the project file still name the relation; after deleting they report a problem and must be adjusted before you can publish. The tasks and steps generated for the relation are removed with it. The relation stays active until you publish.

## Geometry on spawn

The choice depends on the child feature type. It never changes the child type's fields; you add or remove a geometry in the builder, in the fields.

- **The child feature type has no geometry of its own:** **Inherit from parent** (the default, as in v3) writes `inherit_position: true` on the relation. The children then sit on the parent and move with it; no pin is needed when creating one. **No own geometry** writes nothing: the children have no position and do not show on the map.
- **The child feature type has a geometry of its own:** only **Draw own geometry** applies. The select shows it, is disabled and says why.

When you edit, the choice is read from the project file (`inherit_position` and the child type's geometry). If the child type gains a geometry later while the relation still inherits, the project file reports `inherit_with_own_geometry`: the row's badge turns red, the select names the problem, and **Draw own geometry** resolves it.
