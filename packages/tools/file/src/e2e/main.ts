// Harness: the real file tool in a field slot with a fake blob port. The produced list is shown as a name row per
// file (the form's gallery draws these in the app) and as JSON for the assertions.
import type { FieldToolContext } from '@ueberblick/ui/tool-api';
import { createFileTool } from '../file-tool';

const app = document.getElementById('app') as HTMLElement;
const valueOut = document.getElementById('value') as HTMLElement;
const rows = document.createElement('ul');
rows.setAttribute('aria-label', 'Attachments');
app.append(rows);
const slot = document.createElement('div');
app.append(slot);

let value: { sha256: string; name: string; mime: string }[] = [];
const ctx: FieldToolContext = {
  field: {
    key: 'anhang',
    id: 'f-anhang',
    label: 'Attachment',
    type: 'file',
    accept: ['application/pdf'],
    maxFiles: 3,
  },
  locale: 'en',
  get value() {
    return value;
  },
  options: {},
  settings: {},
  preferences: {},
  setPreference: () => {},
  ports: {
    blobs: { put: async () => {} },
    hash: {
      sha256: async (buffer) => {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
      },
    },
    position: { current: () => Promise.reject(new Error('no position')) },
  },
  produce(next) {
    value = next as typeof value;
    rows.replaceChildren(
      ...value.map((f) => {
        const li = document.createElement('li');
        li.textContent = f.name;
        return li;
      }),
    );
    valueOut.textContent = JSON.stringify(value);
  },
  clear() {},
};

createFileTool().mount(slot, ctx);
