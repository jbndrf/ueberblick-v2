# Set icons and colours of the objects

On the map, participants read the state of an object from its **icon** and **colour**: a red warning triangle for *defect open*, for example. You set this on the **data page of an object type** with the **Icons** button (next to "Import CSV" and "Builder"). It opens the **icon designer**.

## Pick the property

At the top is **Property for icons and filters**. The choices are **none** and every select property of the object type, including the **status property** (the stages of the process). Multiselect properties are not offered: an object needs exactly one value to decide its icon. The same property also groups the objects in the Einfach filters and in the cluster details of the map. A role that may not read this property (visibility per property) sees the object type unclassified: the type's own icon and colour, and no per-value switches, rows or counts.

If you switch the property, the entries whose value also exists in the new property stay. If some entries have no matching value, the designer asks first which ones would be removed. **none** removes the property together with all entries.

## The default icon

The first block sets the **default icon** of the object type. It applies when no value-specific icon is set, and to objects whose property has no value. **Set icon** (or **Edit**) opens the editor, the bin removes icon and colour again. Without a default icon the map draws a coloured dot.

## An icon per value

With a property picked, **Icons per value** follows: one row per value of the property, labelled in the interface language. For the status property a badge shows which stage is **Start**, **Step** or **End**. **Set** (or **Edit**) opens the editor, the bin removes the entry; the row then reads **Uses default** again. A row without its own icon shows the default icon faded.

## The editor

- **Templates:** circle, square, triangle, diamond, hexagon, pentagon, pin, flag, cross. The project file stores pin and flag as icon names and the others as an embedded SVG.
- **Custom SVG:** upload an SVG file or paste the code. The designer checks the SVG as publishing does: at most 50 KB, plain shapes only, no scripts, no links to other files. An invalid SVG is refused in place and not saved.
- **Icon colour:** one colour. It tints the template, the dot, and the lines and areas of the object type. A custom SVG keeps its own colours.
- **Size (px):** 8 to 128, default 32. Other values are refused.
- **Badge:** a small mark in the top right corner (check, question, alert, info, X, clock). Templates only.
- **Preview** shows the result at once. **Save icon** writes it to the **draft**.

Border, background, shadow and pin shape are gone: v3 never saved them as anything but switched off.

## Publish

Every change is in the draft of the project file at once, and the publish bar shows it. The icons appear on the map with the next **Publish**.
