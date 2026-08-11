import type { AvailabilityLocationPreference } from "@/lib/types";

export const DEFAULT_SCHEDULE_SLOTS = [
  "00:00 - 02:00",
  "06:00 - 08:00",
  "08:00 - 10:00",
  "10:00 - 12:00",
  "12:00 - 14:00",
  "14:00 - 16:00",
  "16:00 - 18:00",
  "18:00 - 20:00",
  "20:00 - 22:00",
  "22:00 - 00:00"
] as const;

export const HOST_AVAILABILITY_LOCATION_OPTIONS: Array<{
  value: AvailabilityLocationPreference;
  label: string;
}> = [
  { value: "both", label: "Home + Studio" },
  { value: "studio", label: "Studio" },
  { value: "home", label: "Home" }
];

export const DEFAULT_HOST_LOCATION_PREFERENCE: AvailabilityLocationPreference = "both";
