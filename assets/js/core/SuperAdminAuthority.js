// UI routing only. Rules and Workers independently verify server-issued claims.
export async function hasSuperAdminClaim(user) {
  if (!user?.uid || typeof user.getIdTokenResult !== 'function') return false;
  return (await user.getIdTokenResult(true)).claims?.superAdmin === true;
}
