import { NextResponse } from 'next/server';
import { userOr401 } from '@/lib/session';
import { exportUserData } from '@/lib/exporting';

/**
 * Full data export. Never gated on a plan: leaving a product that holds health
 * information must not require paying for it.
 */
export async function GET() {
  const user = await userOr401();
  if (!user) return new NextResponse('Sign in required', { status: 401 });

  const payload = exportUserData(user.id);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="carecircle-export-${stamp}.json"`,
      'Cache-Control': 'private, no-store, max-age=0',
    },
  });
}
