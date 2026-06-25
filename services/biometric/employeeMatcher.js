export function normalizeName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function nameTokens(value) {
  return normalizeName(value).split(" ").filter((t) => t.length > 1);
}

/**
 * Score how well a biometric device name matches a portal user name.
 * Higher = better. Returns 0 if no meaningful match.
 */
export function scoreNameMatch(biometricName, portalName) {
  const bio = normalizeName(biometricName);
  const portal = normalizeName(portalName);
  if (!bio || !portal) return 0;
  if (bio === portal) return 1000;

  // Device often stores first name only — portal may have full name
  if (portal === bio || portal.startsWith(`${bio} `)) {
    return 800 + portal.split(" ").length * 10;
  }

  const bioTokens = nameTokens(biometricName);
  const portalTokens = nameTokens(portalName);
  if (bioTokens.length === 0 || portalTokens.length === 0) return 0;

  const overlap = bioTokens.filter((t) => portalTokens.includes(t)).length;
  if (overlap === 0) return 0;

  const coverage = overlap / bioTokens.length;
  const score = Math.round(coverage * 500 + overlap * 50);

  // Prefer fuller portal names when device has a short name
  if (bioTokens.length === 1 && portalTokens[0] === bioTokens[0]) {
    return score + portalTokens.length * 15;
  }

  return score;
}

export function findBestPortalMatch(biometricName, portalMembers, usedUserIds = new Set()) {
  let best = null;
  let bestScore = 0;

  for (const member of portalMembers) {
    if (usedUserIds.has(Number(member.user_id))) continue;
    const score = scoreNameMatch(biometricName, member.user_name);
    if (score > bestScore) {
      bestScore = score;
      best = member;
    } else if (score === bestScore && best && score > 0) {
      if (String(member.user_name).length > String(best.user_name).length) {
        best = member;
      }
    }
  }

  return bestScore >= 120 ? best : null;
}
