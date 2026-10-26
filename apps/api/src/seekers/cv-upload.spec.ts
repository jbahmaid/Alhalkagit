import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FileInterceptor } from '@nestjs/platform-express';
import { lastValueFrom, of } from 'rxjs';

/**
 * The CV upload goes through Nest's FileInterceptor (multer). A broken dependency tree once left
 * multer's content-type check unable to recognise multipart bodies, so every upload arrived
 * without a file (FILE_REQUIRED) while the rest of the suite stayed green. This parses a real
 * multipart request with the same options as POST /me/profile/cv.
 */
describe('CV upload parsing (FileInterceptor / multer)', () => {
  it('receives the file from a multipart body, with a UTF-8 file name', async () => {
    const Interceptor = FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 },
      defParamCharset: 'utf8',
    });
    const interceptor = new (Interceptor as any)();
    let seen: { originalname: string; mimetype: string; size: number } | undefined;
    const server = createServer(async (req, res) => {
      const ctx = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
      await lastValueFrom(await interceptor.intercept(ctx, { handle: () => of(null) }));
      seen = (req as IncomingMessage & { file?: typeof seen }).file;
      res.end('ok');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const fd = new FormData();
      fd.append(
        'file',
        new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }),
        'سيرتي.pdf',
      );
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: fd });
      expect(res.status).toBe(200);
    } finally {
      server.close();
    }
    expect(seen).toMatchObject({ originalname: 'سيرتي.pdf', mimetype: 'application/pdf', size: 15 });
  });
});
