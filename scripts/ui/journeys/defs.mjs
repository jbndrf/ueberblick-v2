// The journey definitions (docs/process/journeys.md part C). Short journeys only (at most about 15 actions):
// split longer ones. Input for the explorer: the ia-map row, the user doc, the role and the fixture project.
// `startPath` is opened by the runner after the seed, so the explorer starts on the screen the journey is about.

export const VIEWPORT_DESKTOP = { width: 1280, height: 800 };
export const VIEWPORT_PHONE = { width: 360, height: 800 };

/** @type {ReadonlyArray<{id:string,title:string,role:string,fixture:string,startPath:string,viewport:{width:number,height:number},maxActions:number,goal:string,docs:string[],iaMap:string}>} */
export const JOURNEYS = [
  {
    id: 'builder-views',
    title: 'Switch the builder views of the Tree feature type',
    role: 'admin (verwaltung)',
    fixture: 'musterstadt-baeume',
    startPath: '/admin/projects/musterstadtbaeume/types/baum/builder',
    viewport: VIEWPORT_DESKTOP,
    maxActions: 12,
    goal:
      'You are a project admin in the builder of the feature type "Tree" (Baum). It opens in the "Workflow" view with the ' +
      'catalog on the left and the details on the right. Use the view switch in the toolbar to open "Model" (it opens on ' +
      '"Fields"; open its "Permissions" view too), then "Code" (the catalog and the details are hidden there), then go back ' +
      'to "Workflow". After each switch check that the chosen view is marked as selected and that the address shows ' +
      '?view= for it. In "Workflow" select one task in the catalog and check that its details open on the right with ' +
      'the tabs Definition, Conditions, Form, Outcomes and YAML. Report anything that does not match the user docs.',
    docs: ['docs/user/admin/builder.en.md'],
    iaMap: 'Admin / builder: toolbar view switch (Workflow, Model, Code), catalog, task details',
  },
  {
    id: 'builder-phone-sheets',
    title: 'Open the catalog and the details sheets on a phone',
    role: 'admin (verwaltung)',
    fixture: 'musterstadt-baeume',
    startPath: '/admin/projects/musterstadtbaeume/types/baum/builder',
    viewport: VIEWPORT_PHONE,
    maxActions: 10,
    goal:
      'You are a project admin in the builder of the feature type "Tree" (Baum) on a phone. The canvas takes the full ' +
      'width. Tap "Catalog" in the toolbar: the catalog opens as a sheet from the left. Choose a task in it: the catalog ' +
      'closes and the details open as a sheet from the bottom. Close the details (Escape or a tap outside), then tap ' +
      '"Details" and check that it shows the same task again (closing keeps the selection). Take a screenshot of each ' +
      'sheet and check that nothing is cut off at 360 px and that the buttons are at least 56 px high. Report anything ' +
      'that does not match the user docs.',
    docs: ['docs/user/admin/builder.en.md'],
    iaMap: 'Admin / builder: phone (below 768 px) catalog sheet and details sheet',
  },
];

export const journeyById = (id) => JOURNEYS.find((j) => j.id === id);
