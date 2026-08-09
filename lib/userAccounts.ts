import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import type { Collection, Filter, WithId } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { AccountType, EmployeeRole, SchedulePerson } from "@/lib/types";

const PASSWORD_COST = 12;
const MAX_PASSWORD_BYTES = 72;
const INITIAL_SESSION_VERSION = 1;

type UserAccount = {
  accountKey: string;
  accountType: AccountType;
  role?: EmployeeRole;
  employeeId?: string;
  displayName: string;
  passwordHash: string;
  sessionVersion?: number;
  lockedAt?: Date | null;
  lockedBy?: string | null;
  passwordChangedAt?: Date;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
};

export type AuthenticatedAccount = {
  accountKey: string;
  sessionVersion: number;
  accountType: AccountType;
  user: string;
  displayName: string;
  role?: EmployeeRole;
  employeeId?: string;
};

export type ManagedEmployeeAccount = {
  accountKey: string;
  displayName: string;
  role: EmployeeRole;
  employeeId: string;
  locked: boolean;
};

let accountIndexesPromise: Promise<unknown> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function employeeAccountKey(role: EmployeeRole, employeeId: string) {
  return `employee:${role}:${normalizeEmployeeId(employeeId)}`;
}

function getSessionVersion(account: Pick<UserAccount, "sessionVersion">) {
  return Number.isInteger(account.sessionVersion) && Number(account.sessionVersion) > 0
    ? Number(account.sessionVersion)
    : INITIAL_SESSION_VERSION;
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function assertPasswordPolicy(password: string) {
  const byteLength = Buffer.byteLength(password, "utf8");
  if (password.length === 0) {
    throw new Error("Mật khẩu không được để trống.");
  }
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new Error("Mật khẩu không được vượt quá 72 byte.");
  }
}

async function getAccountsCollection(): Promise<Collection<UserAccount>> {
  const database = await getMongoDatabase();
  const collection = database.collection<UserAccount>("schedule_users");
  if (!accountIndexesPromise) {
    accountIndexesPromise = Promise.all([
      collection.createIndex({ accountKey: 1 }, { unique: true }),
      collection.createIndex({ accountType: 1, role: 1, displayName: 1 })
    ]).catch((error) => {
      accountIndexesPromise = null;
      throw error;
    });
  }
  await accountIndexesPromise;
  return collection;
}

function toAuthenticatedAccount(account: WithId<UserAccount> | UserAccount): AuthenticatedAccount {
  return {
    accountKey: account.accountKey,
    sessionVersion: getSessionVersion(account),
    accountType: account.accountType,
    user: account.accountType === "admin" ? "admin" : account.employeeId || account.accountKey,
    displayName: account.displayName,
    role: account.role,
    employeeId: account.employeeId
  };
}

function accountVersionFilter(account: WithId<UserAccount>): Filter<UserAccount> {
  return account.sessionVersion == null
    ? { _id: account._id, sessionVersion: { $exists: false } }
    : { _id: account._id, sessionVersion: account.sessionVersion };
}

export async function employeeHasPassword(role: EmployeeRole, employeeId: string) {
  const collection = await getAccountsCollection();
  const account = await collection.findOne(
    { accountKey: employeeAccountKey(role, employeeId) },
    { projection: { passwordHash: 1 } }
  );
  return Boolean(account?.passwordHash);
}

export async function validateAccountSession(identity: {
  accountKey: string;
  sessionVersion: number;
  accountType: AccountType;
  role?: EmployeeRole;
  employeeId?: string;
}): Promise<AuthenticatedAccount | null> {
  const collection = await getAccountsCollection();
  const account = await collection.findOne({ accountKey: identity.accountKey });
  if (!account || account.lockedAt || getSessionVersion(account) !== identity.sessionVersion) return null;
  if (account.accountType !== identity.accountType) return null;
  if (account.accountType === "employee") {
    if (account.role !== identity.role) return null;
    if (normalizeEmployeeId(account.employeeId || "") !== normalizeEmployeeId(identity.employeeId || "")) return null;
  }
  return toAuthenticatedAccount(account);
}

export async function authenticateEmployee(input: {
  person: SchedulePerson;
  password: string;
  confirmPassword?: string;
  createPassword?: boolean;
}): Promise<AuthenticatedAccount> {
  assertPasswordPolicy(input.password);
  const collection = await getAccountsCollection();
  const accountKey = employeeAccountKey(input.person.role, input.person.id);
  const existing = await collection.findOne({ accountKey });
  const now = new Date();

  if (existing) {
    if (input.createPassword) {
      throw new Error("Không thể tạo mật khẩu cho tài khoản này. Hãy đăng nhập hoặc liên hệ Admin.");
    }
    const matches = await bcrypt.compare(input.password, existing.passwordHash);
    if (!matches) {
      throw new Error("Mã nhân viên hoặc mật khẩu không đúng.");
    }
    if (existing.lockedAt) {
      throw new Error("Tài khoản đang bị khóa. Vui lòng liên hệ Admin.");
    }
    const sessionVersion = getSessionVersion(existing);
    await collection.updateOne(
      { _id: existing._id },
      {
        $set: {
          displayName: input.person.name,
          employeeId: input.person.id,
          role: input.person.role,
          sessionVersion,
          updatedAt: now,
          lastLoginAt: now
        }
      }
    );
    return {
      ...toAuthenticatedAccount(existing),
      sessionVersion,
      displayName: input.person.name,
      employeeId: input.person.id
    };
  }

  if (!input.createPassword) {
    throw new Error("Mã nhân viên hoặc mật khẩu không đúng.");
  }
  if (!input.confirmPassword || input.password !== input.confirmPassword) {
    throw new Error("Mật khẩu nhập lại không khớp.");
  }

  const passwordHash = await bcrypt.hash(input.password, PASSWORD_COST);
  const account: UserAccount = {
    accountKey,
    accountType: "employee",
    role: input.person.role,
    employeeId: input.person.id,
    displayName: input.person.name,
    passwordHash,
    sessionVersion: INITIAL_SESSION_VERSION,
    lockedAt: null,
    passwordChangedAt: now,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  try {
    const result = await collection.insertOne(account);
    return toAuthenticatedAccount({ ...account, _id: result.insertedId });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new Error("Không thể hoàn tất yêu cầu. Hãy đăng nhập hoặc liên hệ Admin.");
    }
    throw error;
  }
}

export async function authenticateAdmin(password: string): Promise<AuthenticatedAccount> {
  assertPasswordPolicy(password);
  const collection = await getAccountsCollection();
  const accountKey = "admin:admin";
  const existing = await collection.findOne({ accountKey });
  const now = new Date();

  if (existing) {
    const matches = await bcrypt.compare(password, existing.passwordHash);
    if (!matches) {
      throw new Error("Mật khẩu admin không đúng.");
    }
    const sessionVersion = getSessionVersion(existing);
    await collection.updateOne(
      { _id: existing._id },
      { $set: { sessionVersion, updatedAt: now, lastLoginAt: now } }
    );
    return { ...toAuthenticatedAccount(existing), sessionVersion };
  }

  const bootstrapPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!bootstrapPassword) {
    throw new Error("Admin chưa được khởi tạo và thiếu ADMIN_BOOTSTRAP_PASSWORD.");
  }
  if (!safeEqualText(password, bootstrapPassword)) {
    throw new Error("Mật khẩu admin không đúng.");
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_COST);
  const account: UserAccount = {
    accountKey,
    accountType: "admin",
    displayName: "Admin",
    passwordHash,
    sessionVersion: INITIAL_SESSION_VERSION,
    lockedAt: null,
    passwordChangedAt: now,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  try {
    const result = await collection.insertOne(account);
    return toAuthenticatedAccount({ ...account, _id: result.insertedId });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new Error("Admin vừa được khởi tạo. Vui lòng đăng nhập lại.");
    }
    throw error;
  }
}

export async function changeOwnPassword(input: {
  accountKey: string;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<AuthenticatedAccount> {
  assertPasswordPolicy(input.currentPassword);
  assertPasswordPolicy(input.newPassword);
  if (input.newPassword !== input.confirmPassword) {
    throw new Error("Mật khẩu mới nhập lại không khớp.");
  }

  const collection = await getAccountsCollection();
  const account = await collection.findOne({ accountKey: input.accountKey });
  if (!account || !(await bcrypt.compare(input.currentPassword, account.passwordHash))) {
    throw new Error("Mật khẩu hiện tại không đúng.");
  }
  if (account.lockedAt) {
    throw new Error("Tài khoản đang bị khóa. Vui lòng liên hệ Admin.");
  }

  const now = new Date();
  const nextSessionVersion = getSessionVersion(account) + 1;
  const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_COST);
  const updateResult = await collection.updateOne(
    accountVersionFilter(account),
    {
      $set: {
        passwordHash,
        sessionVersion: nextSessionVersion,
        passwordChangedAt: now,
        updatedAt: now
      }
    }
  );
  if (updateResult.modifiedCount !== 1) {
    throw new Error("Tài khoản vừa được thay đổi ở nơi khác. Vui lòng đăng nhập lại.");
  }

  return toAuthenticatedAccount({ ...account, passwordHash, sessionVersion: nextSessionVersion, updatedAt: now });
}

export async function listManagedEmployeeAccounts(): Promise<ManagedEmployeeAccount[]> {
  const collection = await getAccountsCollection();
  const accounts = await collection
    .find({ accountType: "employee" })
    .sort({ role: 1, displayName: 1, employeeId: 1 })
    .toArray();

  return accounts.flatMap((account) => {
    if (!account.role || !account.employeeId) return [];
    return [{
      accountKey: account.accountKey,
      displayName: account.displayName || account.employeeId,
      role: account.role,
      employeeId: account.employeeId,
      locked: Boolean(account.lockedAt)
    }];
  });
}

export async function resetEmployeePassword(input: {
  accountKey: string;
  newPassword: string;
  confirmPassword: string;
  actorAccountKey: string;
}): Promise<void> {
  assertPasswordPolicy(input.newPassword);
  if (input.newPassword !== input.confirmPassword) {
    throw new Error("Mật khẩu mới nhập lại không khớp.");
  }

  const collection = await getAccountsCollection();
  const account = await collection.findOne({ accountKey: input.accountKey, accountType: "employee" });
  if (!account) throw new Error("Không tìm thấy tài khoản nhân viên.");

  const now = new Date();
  const passwordHash = await bcrypt.hash(input.newPassword, PASSWORD_COST);
  const updateResult = await collection.updateOne(
    accountVersionFilter(account),
    {
      $set: {
        passwordHash,
        sessionVersion: getSessionVersion(account) + 1,
        passwordChangedAt: now,
        updatedAt: now,
        updatedBy: input.actorAccountKey
      }
    }
  );
  if (updateResult.modifiedCount !== 1) {
    throw new Error("Tài khoản vừa được thay đổi ở nơi khác. Vui lòng tải lại danh sách.");
  }
}

export async function setEmployeeAccountLocked(input: {
  accountKey: string;
  locked: boolean;
  actorAccountKey: string;
}): Promise<void> {
  const collection = await getAccountsCollection();
  const account = await collection.findOne({ accountKey: input.accountKey, accountType: "employee" });
  if (!account) throw new Error("Không tìm thấy tài khoản nhân viên.");

  const now = new Date();
  const updateResult = await collection.updateOne(
    accountVersionFilter(account),
    {
      $set: {
        sessionVersion: getSessionVersion(account) + 1,
        lockedAt: input.locked ? now : null,
        lockedBy: input.locked ? input.actorAccountKey : null,
        updatedAt: now,
        updatedBy: input.actorAccountKey
      }
    }
  );
  if (updateResult.modifiedCount !== 1) {
    throw new Error("Tài khoản vừa được thay đổi ở nơi khác. Vui lòng tải lại danh sách.");
  }
}

export async function revokeEmployeeSessions(input: {
  accountKey: string;
  actorAccountKey: string;
}): Promise<void> {
  const collection = await getAccountsCollection();
  const account = await collection.findOne({ accountKey: input.accountKey, accountType: "employee" });
  if (!account) throw new Error("Không tìm thấy tài khoản nhân viên.");

  const updateResult = await collection.updateOne(
    accountVersionFilter(account),
    {
      $set: {
        sessionVersion: getSessionVersion(account) + 1,
        updatedAt: new Date(),
        updatedBy: input.actorAccountKey
      }
    }
  );
  if (updateResult.modifiedCount !== 1) {
    throw new Error("Tài khoản vừa được thay đổi ở nơi khác. Vui lòng tải lại danh sách.");
  }
}
