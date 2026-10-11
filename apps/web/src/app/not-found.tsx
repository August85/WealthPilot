import Link from 'next/link';

import { BrandMark } from '@/components/shell/Brand';

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <BrandMark className="size-12" />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">The page you’re looking for doesn’t exist or has moved.</p>
      <Link href="/overview" className="font-medium text-link hover:underline">
        Go to your overview
      </Link>
    </main>
  );
}
