/**
 * Whether the deploy overview is open (WP-360). One dialog is mounted once in the admin shell; the publish bar and the
 * builder toolbar both open it through `deployOverview.show()` (R1: one component, two openers). A later opener (a
 * role app's own publish button, H3) calls the same function.
 */
class DeployOverviewStore {
  open = $state(false);
  /** The version the last deploy made, for the status line of the publish bar; cleared by the bar itself. */
  published = $state<number | null>(null);

  show(): void {
    this.open = true;
  }
}

export const deployOverview = new DeployOverviewStore();
