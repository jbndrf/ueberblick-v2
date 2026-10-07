<script lang="ts">
  // A kit Dialog with a MultiSelect inside, as the admin dialogs use it. Test fixture only.
  import * as Dialog from '../index';
  import { MultiSelect } from '../../multi-select';
  import { Popover, PopoverContent, PopoverTrigger } from '../../popover';
  import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
  } from '../../dropdown-menu';
  import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../tooltip';

  const options = ['Eiche', 'Buche', 'Ahorn', 'Linde', 'Birke', 'Kiefer'].map((l) => ({
    value: l.toLowerCase(),
    label: l,
  }));
  let selected = $state<string[]>([]);
  let picked = $state('');
</script>

<Dialog.Root open>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Mitglieder</Dialog.Title>
      <Dialog.Description>Wähle die Baumarten.</Dialog.Description>
    </Dialog.Header>
    <MultiSelect {options} bind:selected id="arten" />
    <div class="flex gap-2">
      <Popover>
        <PopoverTrigger>Popover</PopoverTrigger>
        <PopoverContent
          ><button type="button" onclick={() => (picked = 'popover')}>Inside popover</button></PopoverContent
        >
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => (picked = 'menu')}>Menu item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Tip</TooltipTrigger>
          <TooltipContent>Tooltip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
    <p data-testid="picked">{picked}</p>
    <p data-testid="values">{selected.join(',')}</p>
  </Dialog.Content>
</Dialog.Root>
