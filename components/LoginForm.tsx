"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeRole, PeoplePayload, SchedulePerson } from "@/lib/types";

type LoginType = "employee" | "admin";
type AccountMode = "idle" | "checking" | "login" | "create";

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.7 6.7A9.8 9.8 0 0 1 12 6c5.2 0 9.3 6 9.5 6.2a.63.63 0 0 1 0 .6 18.7 18.7 0 0 1-4 4.6" />
      <path d="M6.2 6.2A18.4 18.4 0 0 0 2.5 12.2a.63.63 0 0 0 0 .6C2.7 13 6.8 19 12 19a9.6 9.6 0 0 0 5.1-1.5" />
      <path d="M9.9 9.9A3 3 0 0 0 12 15a3 3 0 0 0 2.1-.9" />
    </svg>
  ) : (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 12.2a.63.63 0 0 0 0 .6C2.7 13 6.8 19 12 19s9.3-6 9.5-6.2a.63.63 0 0 0 0-.6C21.3 12 17.2 6 12 6S2.7 12 2.5 12.2Z" />
      <circle cx="12" cy="12.5" r="3" />
    </svg>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const [loginType, setLoginType] = useState<LoginType>("employee");
  const [role, setRole] = useState<EmployeeRole>("host");
  const [employeeId, setEmployeeId] = useState("");
  const [hosts, setHosts] = useState<SchedulePerson[]>([]);
  const [supports, setSupports] = useState<SchedulePerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [peopleMessage, setPeopleMessage] = useState("");
  const [accountMode, setAccountMode] = useState<AccountMode>("idle");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const people = role === "host" ? hosts : supports;
  const selectedPerson = people.find((person) => person.id === employeeId);
  const passwordInputDisabled =
    loginType === "employee" &&
    accountMode !== "login" &&
    accountMode !== "create";

  useEffect(() => {
    let active = true;

    void fetch("/api/people", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as PeoplePayload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || payload.error || "Không tải được danh sách nhân viên.");
        }

        if (active) {
          const nextHosts = payload.hosts || [];
          const nextSupports = payload.supports || [];
          setHosts(nextHosts);
          setSupports(nextSupports);
          setPeopleMessage(
            nextHosts.length === 0 && nextSupports.length === 0
              ? payload.message || "Danh sách nhân viên chưa được Admin đồng bộ."
              : ""
          );
        }
      })
      .catch((loadError) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách nhân viên.");
        }
      })
      .finally(() => {
        if (active) setPeopleLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (loginType !== "employee" || !employeeId) {
      setAccountMode("idle");
      setShowPassword(false);
      setShowConfirmPassword(false);
      return;
    }

    let active = true;
    setAccountMode("checking");
    setError("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);

    void fetch("/api/login/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, employeeId })
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          success?: boolean;
          hasPassword?: boolean;
          message?: string;
        };

        if (!response.ok || !payload.success) {
          throw new Error(payload.message || "Không kiểm tra được tài khoản.");
        }

        if (active) setAccountMode(payload.hasPassword ? "login" : "create");
      })
      .catch((statusError) => {
        if (active) {
          setAccountMode("idle");
          setError(statusError instanceof Error ? statusError.message : "Không kiểm tra được tài khoản.");
        }
      });

    return () => {
      active = false;
    };
  }, [employeeId, loginType, role]);

  function chooseLoginType(nextType: LoginType) {
    setLoginType(nextType);
    setError("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
    setAccountMode(nextType === "admin" ? "login" : "idle");
  }

  function chooseRole(nextRole: EmployeeRole) {
    setRole(nextRole);
    setEmployeeId("");
    setAccountMode("idle");
    setError("");
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirmPassword(false);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (loginType === "employee" && (!employeeId || accountMode === "idle" || accountMode === "checking")) {
        throw new Error("Vui lòng chọn nhân viên và chờ kiểm tra tài khoản.");
      }

      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          loginType,
          role: loginType === "employee" ? role : undefined,
          employeeId: loginType === "employee" ? employeeId : undefined,
          password,
          confirmPassword: accountMode === "create" ? confirmPassword : undefined,
          createPassword: accountMode === "create"
        })
      });

      const payload = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Không đăng nhập được.");
      }

      router.replace("/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Không đăng nhập được.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="loginForm" onSubmit={handleSubmit}>
      <div className="loginTypeTabs" role="tablist" aria-label="Loại đăng nhập">
        <button
          aria-selected={loginType === "employee"}
          className={loginType === "employee" ? "active" : ""}
          onClick={() => chooseLoginType("employee")}
          role="tab"
          type="button"
        >
          Nhân viên
        </button>
        <button
          aria-selected={loginType === "admin"}
          className={loginType === "admin" ? "active" : ""}
          onClick={() => chooseLoginType("admin")}
          role="tab"
          type="button"
        >
          Admin
        </button>
      </div>

      {loginType === "employee" ? (
        <>
          <label>
            Vai trò
            <select value={role} onChange={(event) => chooseRole(event.target.value as EmployeeRole)}>
              <option value="host">Host</option>
              <option value="support">Support Live</option>
            </select>
          </label>

          <label>
            Nhân viên
            <select
              value={employeeId}
              onChange={(event) => setEmployeeId(event.target.value)}
              disabled={peopleLoading}
              required
            >
              <option value="">
                {peopleLoading ? "Đang tải danh sách..." : `Chọn ${role === "host" ? "host" : "support"}`}
              </option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name} · {person.id}
                </option>
              ))}
            </select>
          </label>

          {selectedPerson && accountMode !== "checking" ? (
            <div className={`accountModeHint ${accountMode === "create" ? "newAccount" : "existingAccount"}`}>
              <strong>{selectedPerson.name}</strong>
              <span>
                {accountMode === "create"
                  ? "Chưa có mật khẩu · Tạo mật khẩu lần đầu"
                  : "Tài khoản đã có mật khẩu · Đăng nhập"}
              </span>
            </div>
          ) : null}

          {accountMode === "checking" ? <p className="formStatus">Đang kiểm tra tài khoản...</p> : null}
          {peopleMessage ? <p className="formStatus">{peopleMessage}</p> : null}
        </>
      ) : (
        <div className="accountModeHint adminAccount">
          <strong>Quản trị viên</strong>
          <span>Toàn quyền cập nhật lịch và xác nhận ca</span>
        </div>
      )}

      <label>
        {accountMode === "create" ? "Tạo mật khẩu" : "Mật khẩu"}
        <span className="passwordInputWrap">
          <input
            autoComplete={accountMode === "create" ? "new-password" : "current-password"}
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Nhập mật khẩu"
            disabled={passwordInputDisabled}
            required
          />
          <button
            type="button"
            className="passwordToggle"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
            aria-pressed={showPassword}
            disabled={passwordInputDisabled}
          >
            <PasswordVisibilityIcon visible={showPassword} />
          </button>
        </span>
      </label>

      {accountMode === "create" ? (
        <label>
          Nhập lại mật khẩu
          <span className="passwordInputWrap">
            <input
              autoComplete="new-password"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Nhập lại mật khẩu mới"
              required
            />
            <button
              type="button"
              className="passwordToggle"
              onClick={() => setShowConfirmPassword((current) => !current)}
              aria-label={showConfirmPassword ? "Ẩn xác nhận mật khẩu" : "Hiện xác nhận mật khẩu"}
              aria-pressed={showConfirmPassword}
            >
              <PasswordVisibilityIcon visible={showConfirmPassword} />
            </button>
          </span>
        </label>
      ) : null}

      {error ? (
        <p className="formError" aria-live="polite">
          {error}
        </p>
      ) : null}

      <button
        className="loginSubmit"
        type="submit"
        disabled={
          loading ||
          (loginType === "employee" &&
            (peopleLoading || !employeeId || (accountMode !== "login" && accountMode !== "create")))
        }
      >
        {loading ? "Đang xử lý..." : accountMode === "create" ? "Tạo mật khẩu và đăng nhập" : "Đăng nhập"}
      </button>
    </form>
  );
}
