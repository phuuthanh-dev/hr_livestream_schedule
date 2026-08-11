export function normalizeLocationCode(value: unknown) {
  return (typeof value === "string" ? value : value == null ? "" : String(value))
    .trim()
    .toLowerCase()
    .replace(/đ/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function normalizeLocationName(value: unknown) {
  return (typeof value === "string" ? value : value == null ? "" : String(value))
    .trim()
    .replace(/\s+/g, " ");
}

export function formatLocationCode(code?: string) {
  if (!code) return "Chưa cấu hình";
  return code
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getDefaultAvailabilityLocation(value?: string): "home" | "studio" | undefined {
  const workLocation = normalizeLocationCode(value);
  if (!workLocation) return undefined;
  return workLocation === "home" || workLocation === "both" ? "home" : "studio";
}

export function resolveAvailabilityLocation(
  workLocationValue?: string,
  requestedValue?: string,
  allowBothOverride = false
): "home" | "studio" | undefined {
  const workLocation = normalizeLocationCode(workLocationValue);
  const defaultLocation = getDefaultAvailabilityLocation(workLocation);
  if (!defaultLocation) return undefined;

  const requestedLocation = normalizeLocationCode(requestedValue);
  if (workLocation === "both" && allowBothOverride && (requestedLocation === "home" || requestedLocation === "studio")) {
    return requestedLocation;
  }
  return defaultLocation;
}
