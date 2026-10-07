import { describe, expect, it, vi } from 'vitest';
import {
  exportUrl,
  fetchDownload,
  filenameFromDisposition,
  pollImport,
  uploadArchive,
  type ImportJob,
} from './archive-client';

const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

describe('export urls and downloads (v3 handleExportArchive / handleExportCsvOnly)', () => {
  it('names the three export endpoints of a project', () => {
    expect(exportUrl('baeume', 'zip')).toBe('/api/admin/p/baeume/export/zip');
    expect(exportUrl('b ä', 'csv')).toBe('/api/admin/p/b%20%C3%A4/export/csv');
    expect(exportUrl('baeume', 'gpkg')).toBe('/api/admin/p/baeume/export/gpkg');
  });

  it('takes the file name from Content-Disposition, else the fallback (v3 cd.match)', () => {
    expect(filenameFromDisposition('attachment; filename="a-b.zip"', 'x.zip')).toBe('a-b.zip');
    expect(filenameFromDisposition(null, 'x.zip')).toBe('x.zip');
  });

  it('returns the blob and its name, or failure on a refusal or a network error', async () => {
    const ok = await fetchDownload('/u', 'x.zip', async () =>
      reply(200, 'bytes', { 'content-disposition': 'attachment; filename="p.zip"' }),
    );
    expect(ok.ok && ok.filename).toBe('p.zip');
    expect((await fetchDownload('/u', 'x.zip', async () => reply(409, {}))).ok).toBe(false);
    expect(
      (
        await fetchDownload('/u', 'x.zip', async () => {
          throw new Error('offline');
        })
      ).ok,
    ).toBe(false);
  });
});

class FakeXhr {
  static last: FakeXhr;
  upload: { onprogress?: (e: { loaded: number; total: number; lengthComputable: boolean }) => void } = {};
  onload?: () => void;
  onerror?: () => void;
  status = 0;
  responseText = '';
  method = '';
  url = '';
  body: unknown;
  constructor() {
    FakeXhr.last = this;
  }
  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }
  headers: Record<string, string> = {};
  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }
  send(body: unknown): void {
    this.body = body;
  }
}
const fake = () => new FakeXhr() as never;

describe('uploadArchive (v3 chunkedUpload, as one streamed request)', () => {
  it('posts the ZIP as the body with the name, reports progress and answers the job', async () => {
    const seen: number[] = [];
    const p = uploadArchive(new File(['x'], 'p.zip'), ' Kopie ', (pct) => seen.push(pct), fake);
    const x = FakeXhr.last;
    expect(x.method).toBe('POST');
    expect(x.url).toBe('/api/admin/projects/import-zip?name=Kopie');
    expect(x.headers).toEqual({ 'content-type': 'application/zip' });
    x.upload.onprogress?.({ loaded: 1, total: 4, lengthComputable: true });
    x.status = 202;
    x.responseText = '{"job":"j1"}';
    x.onload?.();
    expect(await p).toEqual({ ok: true, job: 'j1' });
    expect(seen).toEqual([25]);
  });

  it('answers the status of a refusal and 0 for a failure of the network', async () => {
    const a = uploadArchive(new File(['x'], 'p.zip'), '', () => undefined, fake);
    expect(FakeXhr.last.url).toBe('/api/admin/projects/import-zip');
    FakeXhr.last.status = 413;
    FakeXhr.last.responseText = '{"error":"The file is too large."}';
    FakeXhr.last.onload?.();
    expect(await a).toEqual({ ok: false, status: 413 });
    const b = uploadArchive(new File(['x'], 'p.zip'), '', () => undefined, fake);
    FakeXhr.last.onerror?.();
    expect(await b).toEqual({ ok: false, status: 0 });
  });
});

describe('pollImport (v3 pollImportStatus)', () => {
  const job = (over: Partial<ImportJob>): { job: ImportJob } => ({
    job: { id: 'j', state: 'running', done: 0, total: 10, ...over },
  });

  it('polls until the job is done and reports every state', async () => {
    const answers = [job({ done: 2 }), job({ done: 7 }), job({ state: 'done', done: 10, key: 'neu' })];
    const fetcher = vi.fn<(url: string) => Promise<Response>>(async () => reply(200, answers.shift()));
    const seen: number[] = [];
    const last = await pollImport(
      'j',
      (j) => seen.push(j.done),
      fetcher,
      async () => undefined,
    );
    expect(last).toMatchObject({ state: 'done', key: 'neu' });
    expect(seen).toEqual([2, 7, 10]);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/projects/import-zip/j');
  });

  it('keeps polling through a network blip, and ends failed for an unknown job (a restart)', async () => {
    let n = 0;
    const fetcher = async (): Promise<Response> => {
      if (n++ === 0) throw new Error('blip');
      return reply(404, {});
    };
    const last = await pollImport(
      'j',
      () => undefined,
      fetcher,
      async () => undefined,
    );
    expect(last.state).toBe('failed');
  });
});
