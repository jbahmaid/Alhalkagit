import { Injectable } from '@nestjs/common';
import { FILE_LINK_TTL_SECONDS, FileLinkDto } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { CryptoService } from '../crypto/crypto.service';

const PURPOSE = 'file-download';

interface LinkPayload {
  /** uploaded_files.id */
  f: string;
  /** user the link was issued to (for the audit trail of later batches) */
  u: string;
  /** expiry, unix seconds */
  e: number;
}

/**
 * Short-lived signed download links (architecture section 8: 5 minutes). The URL is a
 * same-origin path (/api/files/<token>) so it works through the web proxy, on the LAN too;
 * the storage server is never exposed to the browser.
 */
@Injectable()
export class FileLinksService {
  constructor(private readonly crypto: CryptoService) {}

  issue(fileId: string, userId: string, now = Date.now()): FileLinkDto {
    const e = Math.floor(now / 1000) + FILE_LINK_TTL_SECONDS;
    const token = this.crypto.signToken(PURPOSE, { f: fileId, u: userId, e } satisfies LinkPayload);
    return { url: `/api/files/${token}`, expiresAt: new Date(e * 1000).toISOString() };
  }

  /** Returns the file id, or throws FILE_LINK_INVALID / FILE_LINK_EXPIRED. */
  verify(token: string, now = Date.now()): { fileId: string; userId: string } {
    const p = this.crypto.verifyToken<LinkPayload>(PURPOSE, token);
    if (!p || typeof p.f !== 'string' || typeof p.e !== 'number') throw Errors.forbidden('FILE_LINK_INVALID');
    if (p.e * 1000 < now) throw Errors.forbidden('FILE_LINK_EXPIRED');
    return { fileId: p.f, userId: p.u };
  }
}
