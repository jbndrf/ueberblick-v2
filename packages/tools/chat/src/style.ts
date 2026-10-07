// The look of the panel body: v3's classes (`MessageList.svelte`, `Composer.svelte`) as plain CSS on the kit's
// colour variables, so the tool needs no Tailwind scan of its package. The panel (shell, header, close) is the app's.
export const STYLE = `
.ub-chat{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--background,#fff);color:var(--foreground,#111)}
.ub-chat-log{flex:1 1 0;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.ub-chat-log:focus-visible{outline:2px solid var(--ring,#005fcc);outline-offset:-2px}
.ub-chat-rows{display:flex;flex-direction:column;padding:.75rem}
.ub-chat-empty{padding:4rem 0;text-align:center;font-size:.875rem;color:var(--muted-foreground,#555)}
.ub-chat-group{display:flex;flex-direction:column;gap:.25rem;align-items:flex-start;padding-bottom:1rem}
.ub-chat-group[data-mine="true"]{align-items:flex-end}
.ub-chat-head{font-size:.75rem;color:var(--muted-foreground,#555)}
.ub-chat-bubble{box-sizing:border-box;max-width:85%;padding:.5rem .75rem;border-radius:1rem;border-bottom-left-radius:.125rem;font-size:1.09375rem;line-height:1.375;background:var(--muted,#eee);color:var(--foreground,#111);box-shadow:0 1px 2px rgb(0 0 0/.08);overflow-wrap:anywhere}
.ub-chat-group[data-mine="true"] .ub-chat-bubble{border-bottom-left-radius:1rem;border-bottom-right-radius:.125rem;background:var(--primary,#1b3a5c);color:var(--primary-foreground,#fff)}
.ub-chat-text{white-space:pre-wrap;overflow-wrap:anywhere}
.ub-chat-chip{display:inline;margin:0 .125rem;padding:.125rem .25rem;border:0;border-radius:.25rem;font:inherit;font-weight:500;background:color-mix(in srgb,var(--primary,#1b3a5c) 15%,transparent);color:var(--primary,#1b3a5c)}
.ub-chat-group[data-mine="true"] .ub-chat-chip{background:color-mix(in srgb,var(--primary-foreground,#fff) 20%,transparent);color:inherit}
.ub-chat-chip[data-me="true"]{background:rgb(253 224 71/.4);color:var(--foreground,#111)}
button.ub-chat-chip{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}
button.ub-chat-chip:focus-visible,.ub-chat-composer :is(select,textarea,button):focus-visible{outline:2px solid var(--ring,#005fcc);outline-offset:2px}
.ub-chat-state{font-size:.75rem;color:var(--muted-foreground,#555);display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
.ub-chat-state button{font:inherit;font-size:.75rem;padding:.25rem .5rem;min-height:1.75rem;border:1px solid var(--border,#767676);border-radius:.375rem;background:var(--background,#fff);color:var(--foreground,#111);cursor:pointer}
.ub-chat-refused{color:var(--destructive,#b00020)}
.ub-chat-composer{flex:0 0 auto;display:flex;flex-wrap:wrap;gap:.5rem;align-items:flex-end;padding:.5rem;border-top:1px solid var(--border,#ddd);background:var(--background,#fff)}
.ub-chat-composer select{box-sizing:border-box;width:10rem;height:2.25rem;font:inherit;font-size:.875rem;padding:0 .5rem;border:1px solid var(--border,#767676);border-radius:.375rem;background:var(--background,#fff);color:var(--foreground,#111)}
.ub-chat-composer textarea{box-sizing:border-box;flex:1 1 8rem;min-height:2.5rem;max-height:8rem;resize:none;padding:.5rem;font:inherit;font-size:.875rem;border:1px solid var(--border,#767676);border-radius:.375rem;background:var(--background,#fff);color:var(--foreground,#111)}
.ub-chat-send{display:flex;align-items:center;justify-content:center;flex:0 0 auto;width:2.75rem;height:2.5rem;border:0;border-radius:.375rem;background:var(--primary,#1b3a5c);color:var(--primary-foreground,#fff);cursor:pointer}
.ub-chat-send:disabled{opacity:.5;cursor:default}
.ub-chat-error{flex:1 0 100%;margin:0;font-size:.75rem;color:var(--destructive,#b00020)}
.ub-chat-note{padding:1rem;font-size:.875rem;text-align:center;color:var(--muted-foreground,#555)}
`;
