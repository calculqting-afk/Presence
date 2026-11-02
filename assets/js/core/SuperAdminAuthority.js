// UI routing only. Rules and Workers independently verify server-issued claims.
export async function hasSuperAdminClaim(user, { forceRefresh = true } = {}) {
  if (!user?.uid || typeof user.getIdTokenResult !== 'function') return false;
  return (await user.getIdTokenResult(forceRefresh)).claims?.superAdmin === true;
}
