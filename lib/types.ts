export type ConfirmRole = "host" | "support" | "both";
export type EmployeeRole = "host" | "support";
export type AccountType = "admin" | "employee";
export type HostWorkLocation = string;
export type ScheduleSessionStatus = "published" | "open" | "canceled" | "completed";

export type ScheduleLocation = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  sortOrder: number;
  system: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type ScheduleLocationsPayload = {
  success: boolean;
  locations?: ScheduleLocation[];
  location?: ScheduleLocation;
  message?: string;
};

export type SchedulePerson = {
  id: string;
  name: string;
  role: EmployeeRole;
  level?: string;
  rating?: string;
  workLocation?: HostWorkLocation;
  phone?: string;
  cvReference?: string;
  cashOffer?: string;
  castStatus?: string;
  experience?: string;
  trainingStatus?: string;
  notes?: string;
  achievements?: string;
  zaloStatus?: string;
  liveAccountType?: string;
  liveChannelId?: string;
  active?: boolean;
  contractProfile?: {
    completed: boolean;
    hasFront: boolean;
    hasBack: boolean;
    updatedAt?: string;
    driveSync?: {
      status: "success" | "error";
      syncedAt?: string;
      folderId?: string;
      error?: string;
    };
  };
  trainingProfile?: {
    rating: string;
    scorePercent: number;
    cashOffer: string;
    passed: boolean;
    updatedAt?: string;
  };
  source?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type EmployeeAdminPayload = {
  success: boolean;
  employees?: SchedulePerson[];
  employee?: SchedulePerson;
  total?: number;
  activeTotal?: number;
  hosts?: number;
  supports?: number;
  incomplete?: number;
  inserted?: number;
  updated?: number;
  deactivated?: number;
  message?: string;
};

export type PeoplePayload = {
  success: boolean;
  generatedAt?: string;
  syncedAt?: string;
  source?: string;
  fallback?: boolean;
  total?: number;
  hosts?: SchedulePerson[];
  supports?: SchedulePerson[];
  error?: string;
  message?: string;
};

export type PeopleSyncPayload = PeoplePayload & {
  syncedAt: string;
  inserted: number;
  updated: number;
  deactivated: number;
  total: number;
};

export type ScheduleSession = {
  rowNumber: number;
  stt: string;
  sessionId: string;
  dateKey: string;
  dateLabel: string;
  weekday: string;
  slot: string;
  slotSortKey: string;
  hostId: string;
  hostName: string;
  format: string;
  supportId: string;
  supportName: string;
  channel: string;
  scriptUrl: string;
  hostConfirm: string;
  supportConfirm: string;
  backupHostId: string;
  backupHostName: string;
  backupSupportId: string;
  backupSupportName: string;
  supportCandidatePool: string;
  status?: ScheduleSessionStatus;
  generatedBy?: "website" | "google_sheet";
  generationBatchId?: string;
  manualOverride?: boolean;
  isHostConfirmed: boolean;
  isSupportConfirmed: boolean;
  canConfirmHost: boolean;
  canConfirmSupport: boolean;
  supportRequired: boolean;
  isSupportOnly: boolean;
  missingSupport: boolean;
  warningLevel: "ok" | "info" | "danger";
  warnings: string[];
};

export type ScheduleSummary = {
  total: number;
  openHost: number;
  supportOnly: number;
  missingSupport: number;
  pendingHostConfirm: number;
  pendingSupportConfirm: number;
  confirmedHost: number;
  confirmedSupport: number;
};

export type SchedulePayload = {
  success: boolean;
  storage?: "mongodb";
  spreadsheetId?: string;
  sheetName?: string;
  generatedAt?: string;
  syncedAt?: string;
  confirmationRevision?: number;
  timezone?: string;
  rowCount?: number;
  summary?: ScheduleSummary;
  rows?: ScheduleSession[];
  sync?: {
    success?: boolean;
    message?: string;
    batchId?: string;
    mode?: "schedule_refresh" | "sheet_snapshot" | "website_generation" | "website_generation_refresh_unconfirmed";
    inserted?: number;
    updated?: number;
    deactivated?: number;
    total?: number;
    syncedAt?: string;
  };
  updatedSessionId?: string;
  updatedRole?: ConfirmRole;
  confirmed?: boolean;
  error?: string;
  message?: string;
};

export type AvailabilityWeekStatus = "draft" | "submitted" | "locked";
export type AvailabilityLocationPreference = "home" | "studio";

export type AvailabilitySlot = {
  dateKey: string;
  slot: string;
  available: boolean;
  locationPreference?: AvailabilityLocationPreference;
  note?: string;
  updatedAt?: string;
};

export type AvailabilityWeek = {
  weekStartKey: string;
  role: EmployeeRole;
  employeeId: string;
  employeeName: string;
  workLocation?: HostWorkLocation;
  workLocationActive?: boolean;
  status: AvailabilityWeekStatus;
  submittedAt?: string;
  lockedAt?: string;
  lockedReason?: string;
  slots: AvailabilitySlot[];
};

export type AvailabilitySummary = {
  totalSlots: number;
  availableSlots: number;
  availableByLocation: Record<string, number>;
};

export type AvailabilityPayload = {
  success: boolean;
  target?: {
    role: EmployeeRole;
    employeeId: string;
    employeeName: string;
    workLocation?: HostWorkLocation;
    workLocationActive?: boolean;
  };
  week?: AvailabilityWeek;
  summary?: AvailabilitySummary;
  canEdit?: boolean;
  error?: string;
  message?: string;
};

export type AvailabilityAdminRoleFilter = "all" | EmployeeRole;
export type AvailabilityAdminStatusFilter = "all" | "submitted" | "not_submitted";
export type AvailabilitySubmissionState = "not_started" | "draft" | "submitted" | "locked";

export type AvailabilityAdminPerson = {
  employeeId: string;
  employeeName: string;
  role: EmployeeRole;
  level?: string;
  workLocation?: HostWorkLocation;
  submissionState: AvailabilitySubmissionState;
  availableSlots: number;
  submittedAt?: string;
  updatedAt?: string;
};

export type AvailabilityAdminSlotSummary = {
  dateKey: string;
  slot: string;
  peopleAvailable: number;
  hostAvailable: number;
  supportAvailable: number;
  hostEmployeeIds: string[];
  supportEmployeeIds: string[];
};

export type AvailabilityAdminDashboardSummary = {
  totalPeople: number;
  submittedPeople: number;
  notSubmittedPeople: number;
  draftPeople: number;
  notStartedPeople: number;
  lockedPeople: number;
  visiblePeople: number;
  visibleAvailableSlots: number;
};

export type AvailabilityAdminDashboardPayload = {
  success: boolean;
  weekStartKey?: string;
  roleFilter?: AvailabilityAdminRoleFilter;
  statusFilter?: AvailabilityAdminStatusFilter;
  generatedAt?: string;
  summary?: AvailabilityAdminDashboardSummary;
  people?: AvailabilityAdminPerson[];
  slots?: AvailabilityAdminSlotSummary[];
  message?: string;
};

export type AvailabilitySheetSyncDirection = "sheet_to_website" | "website_to_sheet";
export type AvailabilitySheetSyncOperation = "import_week" | "sync_week";
export type AvailabilitySheetSyncConflictKind =
  | "unknown_employee"
  | "invalid_row"
  | "import_blocked"
  | "force_import"
  | "website_overwrite"
  | "sheet_overwrite"
  | "missing_sheet_row";

export type AvailabilitySheetSyncRun = {
  runId: string;
  direction: AvailabilitySheetSyncDirection;
  operation: AvailabilitySheetSyncOperation;
  weekStartKey?: string;
  spreadsheetId: string;
  actorAccountKey: string;
  success: boolean;
  startedAt: string;
  finishedAt: string;
  importedWeeks?: number;
  importedPeople?: number;
  importedSlots?: number;
  hostRowsUpdated?: number;
  supportRowsUpdated?: number;
  conflictCount: number;
  message?: string;
  error?: string;
};

export type AvailabilitySheetSyncConflict = {
  runId: string;
  direction: AvailabilitySheetSyncDirection;
  kind: AvailabilitySheetSyncConflictKind;
  weekStartKey?: string;
  role?: EmployeeRole;
  employeeId?: string;
  dateKey?: string;
  slot?: string;
  tabName?: string;
  rowNumber?: number;
  details: string;
  createdAt: string;
};

export type AvailabilitySheetSyncLogsPayload = {
  success: boolean;
  weekStartKey?: string;
  runs?: AvailabilitySheetSyncRun[];
  conflicts?: AvailabilitySheetSyncConflict[];
  message?: string;
};

export type RecruitmentSheetSyncDirection = "sheet_to_website" | "website_to_sheet";
export type RecruitmentSheetSyncOperation = "import_profiles" | "import_profiles_dry_run" | "sync_profiles";
export type RecruitmentSheetSyncConflictKind =
  | "unknown_employee"
  | "missing_sheet_row"
  | "missing_contract_profile"
  | "sheet_row_created"
  | "invalid_row"
  | "website_overwrite"
  | "sheet_overwrite";

export type RecruitmentSheetSyncRun = {
  runId: string;
  direction: RecruitmentSheetSyncDirection;
  operation: RecruitmentSheetSyncOperation;
  spreadsheetId: string;
  actorAccountKey: string;
  success: boolean;
  startedAt: string;
  finishedAt: string;
  processedRows?: number;
  updatedProfiles?: number;
  updatedEmployees?: number;
  createdEmployees?: number;
  updatedContracts?: number;
  updatedSheetRows?: number;
  appendedSheetRows?: number;
  skippedRows?: number;
  conflictCount: number;
  message?: string;
  error?: string;
};

export type RecruitmentSheetSyncConflict = {
  runId: string;
  direction: RecruitmentSheetSyncDirection;
  kind: RecruitmentSheetSyncConflictKind;
  role?: EmployeeRole;
  employeeId?: string;
  tabName?: string;
  rowNumber?: number;
  details: string;
  createdAt: string;
};

export type RecruitmentSheetSyncLogsPayload = {
  success: boolean;
  runs?: RecruitmentSheetSyncRun[];
  conflicts?: RecruitmentSheetSyncConflict[];
  message?: string;
};

export type PayrollRole = EmployeeRole;
export type PayrollCommissionMode = "none" | "fixed" | "gmv_tier";
export type PayrollPeriodStatus = "draft" | "locked";

export type PayrollRateCard = {
  id: string;
  role: PayrollRole;
  grade: string;
  hourlyRate: number;
  commissionMode: PayrollCommissionMode;
  commissionRate: number;
  sortOrder: number;
  active: boolean;
  note?: string;
};

export type PayrollGmvTier = {
  minimumGmv: number;
  commissionRate: number;
};

export type PayrollSettings = {
  taxRate: number;
  joinGapMinutes: number;
  hostGmvTiers: PayrollGmvTier[];
};

export type PayrollEntry = {
  entryKey: string;
  weekStartKey: string;
  weekEndKey: string;
  dateKey: string;
  role: PayrollRole;
  employeeId: string;
  employeeName: string;
  grade: string;
  location: "home" | "studio";
  accountId: string;
  sessionIds: string[];
  tiktokLiveIds: string[];
  scheduledHours: number;
  hourlyRate: number;
  grossGmv: number;
  returnedGmv: number;
  eligibleGmv: number;
  commissionRate: number;
  basePay: number;
  commissionPay: number;
  adjustments: number;
  grossPay: number;
  taxRate: number;
  taxAmount: number;
  netPay: number;
  generatedAt: string;
};

export type PayrollExceptionType =
  | "missing_report"
  | "unmatched_report"
  | "missing_account"
  | "missing_rate"
  | "ambiguous_assignment"
  | "unconfirmed_shift";

export type PayrollException = {
  exceptionKey: string;
  type: PayrollExceptionType;
  dateKey: string;
  message: string;
  accountId?: string;
  sessionId?: string;
  employeeId?: string;
  tiktokLiveIds?: string[];
};

export type PayrollImportRecord = {
  batchId: string;
  fileName: string;
  importedAt: string;
  importedBy: string;
  totalRows: number;
  inserted: number;
  duplicates: number;
  invalidRows: number;
  dateFrom?: string;
  dateTo?: string;
};

export type PayrollDashboardSummary = {
  employeeCount: number;
  entryCount: number;
  scheduledHours: number;
  grossGmv: number;
  basePay: number;
  commissionPay: number;
  taxAmount: number;
  netPay: number;
  exceptionCount: number;
};

export type PayrollPersonHours = {
  employeeId: string;
  employeeName: string;
  role: PayrollRole;
  grade: string;
  sessionCount: number;
  scheduledHours: number;
  netPay: number;
};

export type PayrollSheetExportTotals = {
  scheduledHours: number;
  basePay: number;
  commissionPay: number;
  adjustments: number;
  grossPay: number;
  taxAmount: number;
  netPay: number;
};

export type PayrollSheetExportRecord = {
  exportId: string;
  weekStartKey: string;
  weekEndKey: string;
  spreadsheetId: string;
  tabTitle: string;
  sheetUrl: string;
  exportedAt: string;
  exportedBy: string;
  rowCount: number;
  totals: PayrollSheetExportTotals;
  exceptionCounts: Record<string, number>;
  verification: {
    checked: number;
    mismatches: number;
    ok: boolean;
  };
  dryRun: boolean;
};

export type PayrollDashboardPayload = {
  success: boolean;
  weekStartKey?: string;
  weekEndKey?: string;
  periodStatus?: PayrollPeriodStatus;
  generatedAt?: string;
  summary?: PayrollDashboardSummary;
  entries?: PayrollEntry[];
  personHours?: PayrollPersonHours[];
  exceptions?: PayrollException[];
  rates?: PayrollRateCard[];
  settings?: PayrollSettings;
  imports?: PayrollImportRecord[];
  sheetExport?: PayrollSheetExportRecord | null;
  message?: string;
};
