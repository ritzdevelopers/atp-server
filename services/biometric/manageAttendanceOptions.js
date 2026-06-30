/** When true (default), manage-attendance lists only portal users linked to a biometric device code. */
export function isMappedEmployeesOnly() {
  return String(process.env.BIOMETRIC_MANAGE_MAPPED_ONLY ?? "true") === "true";
}

/** When true (default), manage-attendance lists only portal users with an @rmw.com email. */
export function isRmwEmailOnly() {
  return String(process.env.BIOMETRIC_MANAGE_RMW_EMAIL_ONLY ?? "true") === "true";
}

export function isRmwPortalEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase()
    .endsWith("@rmw.com");
}
