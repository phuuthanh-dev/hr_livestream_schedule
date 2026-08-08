export type ConfirmRole = "host" | "support" | "both";
export type EmployeeRole = "host" | "support";
export type AccountType = "admin" | "employee";

export type SchedulePerson = {
  id: string;
  name: string;
  role: EmployeeRole;
  level?: string;
};

export type PeoplePayload = {
  success: boolean;
  generatedAt?: string;
  source?: string;
  fallback?: boolean;
  hosts?: SchedulePerson[];
  supports?: SchedulePerson[];
  error?: string;
  message?: string;
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
  supportOnly: number;
  missingSupport: number;
  pendingHostConfirm: number;
  pendingSupportConfirm: number;
  confirmedHost: number;
  confirmedSupport: number;
};

export type SchedulePayload = {
  success: boolean;
  spreadsheetId?: string;
  sheetName?: string;
  generatedAt?: string;
  timezone?: string;
  rowCount?: number;
  summary?: ScheduleSummary;
  rows?: ScheduleSession[];
  sync?: {
    success?: boolean;
    message?: string;
  };
  updatedSessionId?: string;
  updatedRole?: ConfirmRole;
  confirmed?: boolean;
  error?: string;
  message?: string;
};
