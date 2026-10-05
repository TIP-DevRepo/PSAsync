// Mirrors the credentials provider in src/auth.ts: once a company turns SSO
// on, password login is refused for every user in that company, so their
// password lives with Microsoft and can't be changed from inside PSAsync.
export function usesMicrosoftSso(settings: { ssoEnabled: boolean } | null | undefined): boolean {
  return !!settings?.ssoEnabled
}
