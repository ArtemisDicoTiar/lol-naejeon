const LCU_AUTO_NAV_SUPPRESS_KEY = 'snowy-hennesys:lcu-auto-nav-suppress-until';

export function suppressLcuAutoNavigate(ms = 120_000): void {
  window.sessionStorage.setItem(LCU_AUTO_NAV_SUPPRESS_KEY, String(Date.now() + ms));
}

export function isLcuAutoNavigateSuppressed(): boolean {
  const until = Number(window.sessionStorage.getItem(LCU_AUTO_NAV_SUPPRESS_KEY) ?? 0);
  if (!Number.isFinite(until) || until <= Date.now()) {
    window.sessionStorage.removeItem(LCU_AUTO_NAV_SUPPRESS_KEY);
    return false;
  }
  return true;
}
