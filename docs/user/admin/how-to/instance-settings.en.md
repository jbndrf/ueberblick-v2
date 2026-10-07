# Instance settings

The **Instance Settings** page applies to the whole instance, not to one project: the consent window (cookie consent) before sign-in and the legal pages. Open it with the **Instance Settings** entry at the end of the sidebar (below the divider), in a project or outside one. Every admin may edit it; the texts are public. The address is `/admin/instance`.

## Cookie Consent Banner
1. **Require cookie consent before login**: when on, participants see a consent window before signing in. When off, the sign-in page shows directly (useful for internal deployments).
2. **Banner heading** and **Banner body** (HTML allowed) fill the window.
3. **Accept button label** and **Reject button label**: an empty field falls back to `Accept` or `Reject`.
4. **Save**. The message "Saved." confirms it.

## Legal Pages
Each page is public at `/legal/<slug>` (the link is on the card and opens in a new tab) and listed at `/legal`. Pages with **Show in consent footer** appear as links in the consent window.

- **Add a page** (card **Add legal page**): **Title**, **Slug (URL)** (empty: made from the title, German umlauts are spelled out, for example `Über uns` becomes `ueber-uns`) and **Content (HTML allowed)**, then **Create page**. A slug may hold only a to z, 0 to 9 and hyphens (up to 100 characters) and must not exist yet.
- **Edit**: change the title, **Order** (small numbers first), the consent footer switch or the content and choose **Save**. A changed slug renames the page; the old address stops working.
- **Delete**: asks "Delete this page?"; **Delete** confirms, **Cancel** keeps the page.

On a phone the fields stack.
