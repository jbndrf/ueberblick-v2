<script lang="ts">
  // A sidebar with a header, a menu, a group and a trigger, for the sidebar spec (WP-320).
  import * as Sidebar from './index';

  let { open = true }: { open?: boolean } = $props();
</script>

<Sidebar.Provider {open}>
  <Sidebar.Root srTitle="Navigation" srDescription="Seitenleiste">
    <Sidebar.Header>Kopf</Sidebar.Header>
    <Sidebar.Content>
      <Sidebar.Menu>
        <Sidebar.MenuItem>
          <Sidebar.MenuButton isActive>
            {#snippet child({ props })}<a href="/x" {...props}>Eins</a>{/snippet}
          </Sidebar.MenuButton>
        </Sidebar.MenuItem>
      </Sidebar.Menu>
      <Sidebar.Group>
        <Sidebar.GroupLabel>Gruppe</Sidebar.GroupLabel>
        <Sidebar.GroupContent>
          <Sidebar.Menu>
            <Sidebar.MenuItem><Sidebar.MenuSubButton href="/y">Zwei</Sidebar.MenuSubButton></Sidebar.MenuItem>
          </Sidebar.Menu>
        </Sidebar.GroupContent>
      </Sidebar.Group>
    </Sidebar.Content>
  </Sidebar.Root>
  <Sidebar.Inset>
    <Sidebar.Trigger label="Seitenleiste umschalten" />
  </Sidebar.Inset>
</Sidebar.Provider>
