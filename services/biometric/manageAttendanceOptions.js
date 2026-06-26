/** When true (default), manage-attendance lists only portal users linked to a biometric device code. */
export function isMappedEmployeesOnly() {
  return String(process.env.BIOMETRIC_MANAGE_MAPPED_ONLY ?? "true") === "true";
}
