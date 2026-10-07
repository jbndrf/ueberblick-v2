<script lang="ts">
  // A sample page that mounts every kit component, for the component and axe specs (WP-610).
  import { Button } from './button';
  import * as Card from './card';
  import * as Tabs from './tabs';
  import { Input } from './input';
  import { Label } from './label';
  import * as Sheet from './sheet';
  import * as Drawer from './drawer';
  import * as Dialog from './dialog';
  import * as AlertDialog from './alert-dialog';
  import { Badge } from './badge';
  import { Switch } from './switch';
  import { Separator } from './separator';
  import * as Tooltip from './tooltip';
  import { Toaster } from './sonner';
  import { Progress } from './progress';
  import { Skeleton } from './skeleton';
  import * as DropdownMenu from './dropdown-menu';
  import { Textarea } from './textarea';
  import { Checkbox } from './checkbox';
  import * as RadioGroup from './radio-group';
  import * as Popover from './popover';
  import { ScrollArea } from './scroll-area';
  import { Spinner } from './spinner';
  import { Sortable } from './sortable';

  let { overlays = true }: { overlays?: boolean } = $props();
</script>

<main>
  <h1>Kit</h1>
  <Button>Save</Button>
  <Button variant="destructive">Delete</Button>
  <Card.Root>
    <Card.Header><Card.Title>Title</Card.Title><Card.Description>About</Card.Description></Card.Header>
    <Card.Content>Body</Card.Content>
    <Card.Footer>Foot</Card.Footer>
  </Card.Root>
  <Tabs.Root value="a">
    <Tabs.List><Tabs.Trigger value="a">A</Tabs.Trigger><Tabs.Trigger value="b">B</Tabs.Trigger></Tabs.List>
    <Tabs.Content value="a">Panel A</Tabs.Content>
    <Tabs.Content value="b">Panel B</Tabs.Content>
  </Tabs.Root>
  <Label for="name">Name</Label>
  <Input id="name" />
  <Label for="note">Note</Label>
  <Textarea id="note" />
  <Badge>New</Badge>
  <Switch aria-label="Notify" />
  <Checkbox aria-label="Agree" />
  <RadioGroup.Root value="x" aria-label="Choice">
    <RadioGroup.Item value="x" aria-label="X" />
    <RadioGroup.Item value="y" aria-label="Y" />
  </RadioGroup.Root>
  <Separator />
  <Progress value={40} aria-label="Done" />
  <Skeleton class="h-4 w-10" />
  <Spinner />
  <ScrollArea class="h-10"><p>Scrollable</p></ScrollArea>
  <Sortable
    items={['one', 'two']}
    key={(k) => k}
    label="Order"
    handleLabel={(k) => `Move ${k}`}
    upLabel={(k) => `Up ${k}`}
    downLabel={(k) => `Down ${k}`}
    onreorder={() => undefined}
  >
    {#snippet row(k, i, grip, moves)}
      <div class="flex items-center gap-2">{@render grip(k)}<span>{k}</span>{@render moves(k, i)}</div>
    {/snippet}
  </Sortable>
  <Toaster />
  {#if overlays}
    <Sheet.Root open>
      <Sheet.Content>
        <Sheet.Header
          ><Sheet.Title>Sheet</Sheet.Title><Sheet.Description>Side panel</Sheet.Description></Sheet.Header
        >
      </Sheet.Content>
    </Sheet.Root>
    <Dialog.Root open>
      <Dialog.Content>
        <Dialog.Header
          ><Dialog.Title>Dialog</Dialog.Title><Dialog.Description>Modal</Dialog.Description></Dialog.Header
        >
      </Dialog.Content>
    </Dialog.Root>
    <AlertDialog.Root open>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Sure?</AlertDialog.Title>
          <AlertDialog.Description>Cannot undo</AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer
          ><AlertDialog.Cancel>No</AlertDialog.Cancel><AlertDialog.Action>Yes</AlertDialog.Action
          ></AlertDialog.Footer
        >
      </AlertDialog.Content>
    </AlertDialog.Root>
    <Drawer.Root open>
      <Drawer.Content>
        <Drawer.Header
          ><Drawer.Title>Drawer</Drawer.Title><Drawer.Description>Bottom</Drawer.Description></Drawer.Header
        >
      </Drawer.Content>
    </Drawer.Root>
    <Popover.Root open
      ><Popover.Trigger>Pop</Popover.Trigger><Popover.Content>Popped</Popover.Content></Popover.Root
    >
    <Tooltip.Provider>
      <Tooltip.Root open
        ><Tooltip.Trigger>Hint</Tooltip.Trigger><Tooltip.Content>Tip</Tooltip.Content></Tooltip.Root
      >
    </Tooltip.Provider>
    <DropdownMenu.Root open>
      <DropdownMenu.Trigger>Menu</DropdownMenu.Trigger>
      <DropdownMenu.Content><DropdownMenu.Item>Item</DropdownMenu.Item></DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}
</main>
