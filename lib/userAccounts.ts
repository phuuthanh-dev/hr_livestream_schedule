import bcrypt from "bcryptjs";
import { timingSafeEqual } from "crypto";
import type { Collection, WithId } from "mongodb";
import { getMongoDatabase } from "@/lib/mongodb";
import type { AccountType, EmployeeRole, SchedulePerson } from "@/lib/types";

const PASSWORD_COST = 12;
const MAX_PASSWORD_BYTES = 72;

type UserAccount = {
  accountKey: string;
  accountType: AccountType;
  role?: EmployeeRole;
  employeeId?: string;
  displayName: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
};

type AuthenticatedAccount = {
  accountType: AccountType;
  user: string;
  displayName: string;
  role?: EmployeeRole;
  employeeId?: string;
};

let accountIndexesPromise: Promise<unknown> | null = null;

function normalizeEmployeeId(employeeId: string) {
  return employeeId.trim().toLowerCase();
}

function employeeAccountKey(role: EmployeeRole, employeeId: string) {
  return `employee:${role}:${normalizeEmployeeId(employeeId)}`;
}

function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function assertPasswordPolicy(password: string) {
  const byteLength = Buffer.byteLength(password, "utf8");
  if (password.length < 8) {
    throw new Error("Mật khẩu phải có ít nhất 8 ký tự.");
  }
  if (byteLength > MAX_PASSWORD_BYTES) {
    throw new Error("Mật khẩu không được vượt quá 72 byte.");
  }
}

async function getAccountsCollection(): Promise<Collection<UserAccount>> {
  const database = await getMongoDatabase();
  const collection = database.collection<UserAccount>("schedule_users");
  if (!accountIndexesPromise) {
    accountIndexesPromise = collection.createIndex({ accountKey: 1 }, { unique: true }).catch((error) => {
      accountIndexesPromise = null;
      throw error;
    });
  }
  await accountIndexesPromise;
  return collection;
}

function toAuthenticatedAccount(account: WithId<UserAccount>): AuthenticatedAccount {
  return {
    accountType: account.accountType,
    user: account.accountType === "admin" ? "admin" : account.employeeId || account.accountKey,
    displayName: account.displayName,
    role: account.role,
    employeeId: account.employeeId
  };
}

export async function employeeHasPassword(role: EmployeeRole, employeeId: string) {
  const collection = await getAccountsCollection();
  const account = await collection.findOne(
    { accountKey: employeeAccountKey(role, employeeId) },
    { projection: { passwordHash: 1 } }
  );
  return Boolean(account?.passwordHash);
}

export async function authenticateEmployee(input: {
  person: SchedulePerson;
  password: string;
  confirmPassword?: string;
  createPassword?: boolean;
}): Promise<{ account: AuthenticatedAccount; created: boolean }> {
  assertPasswordPolicy(input.password);
  const collection = await getAccountsCollection();
  const accountKey = employeeAccountKey(input.person.role, input.person.id);
  const existing = await collection.findOne({ accountKey });
  const now = new Date();

  if (existing) {
    const matches = await bcrypt.compare(input.password, existing.passwordHash);
    if (!matches) {
      throw new Error("Mật khẩu không đúng.");
    }
    await collection.updateOne(
      { _id: existing._id },
      { $set: { displayName: input.person.name, employeeId: input.person.id, updatedAt: now, lastLoginAt: now } }
    );
    return {
      account: {
        ...toAuthenticatedAccount(existing),
        displayName: input.person.name,
        employeeId: input.person.id
      },
      created: false
    };
  }

  if (!input.createPassword) {
    throw new Error("Tài khoản chưa có mật khẩu. Vui lòng tạo mật khẩu mới.");
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
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  try {
    const result = await collection.insertOne(account);
    return { account: toAuthenticatedAccount({ ...account, _id: result.insertedId }), created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new Error("Tài khoản vừa được tạo ở nơi khác. Vui lòng đăng nhập lại.");
    }
    throw error;
  }
}

export async function authenticateAdmin(password: string): Promise<{ account: AuthenticatedAccount; created: boolean }> {
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
    await collection.updateOne({ _id: existing._id }, { $set: { updatedAt: now, lastLoginAt: now } });
    return { account: toAuthenticatedAccount(existing), created: false };
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
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };

  try {
    const result = await collection.insertOne(account);
    return { account: toAuthenticatedAccount({ ...account, _id: result.insertedId }), created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new Error("Admin vừa được khởi tạo. Vui lòng đăng nhập lại.");
    }
    throw error;
  }
}
