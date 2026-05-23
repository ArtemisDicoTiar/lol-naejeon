import { GIT_HASH, GIT_COUNT, BUILD_TIME } from '@/version.generated';

function formatKST(isoString: string): string {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y  = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(kst.getUTCDate()).padStart(2, '0');
  const h  = String(kst.getUTCHours()).padStart(2, '0');
  const mn = String(kst.getUTCMinutes()).padStart(2, '0');
  return `KST ${y}/${mo}/${dy} ${h}:${mn}`;
}

export function Footer() {
  const version = `v0.0.${GIT_COUNT} (${GIT_HASH}) ${formatKST(BUILD_TIME)}`;
  return (
    <footer className="border-t border-lol-border/30 mt-auto py-2 px-4">
      <p className="text-center text-[10px] font-mono text-lol-gold-light/25 select-none">
        {version}
      </p>
    </footer>
  );
}
