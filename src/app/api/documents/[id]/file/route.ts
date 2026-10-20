import { NextResponse } from 'next/server';
import { userOr401 } from '@/lib/session';
import { readDocumentBytes } from '@/lib/documents';
import { AuthzError } from '@/lib/authz';

/**
 * The only route that returns document bytes. Private files live outside the web
 * root, so there is no static URL to guess: every byte passes the authorisation
 * check in readDocumentBytes, which also writes the access to the audit log.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await userOr401();
  if (!user) return new NextResponse('Sign in required', { status: 401 });

  const { id } = await params;
  const version = new URL(request.url).searchParams.get('v');
  const download = new URL(request.url).searchParams.get('download') === '1';

  try {
    const file = readDocumentBytes(user.id, id, version ?? undefined);
    // Inline preview is restricted to formats a browser renders without scripting.
    // Anything else is forced to download so a file can never execute in our origin.
    const previewable = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain'];
    const inline = !download && previewable.includes(file.mimeType);
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        'Content-Type': file.mimeType,
        'Content-Length': String(file.bytes.byteLength),
        'Content-Disposition':
          `${inline ? 'inline' : 'attachment'}; filename="${file.filename.replace(/"/g, '')}"`,
        // Never cached by a shared cache, and never indexed.
        'Cache-Control': 'private, no-store, max-age=0',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    if (err instanceof AuthzError) return new NextResponse('Not available', { status: 403 });
    return new NextResponse('Not found', { status: 404 });
  }
}
