"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EmployeeRole, PeoplePayload, SchedulePerson } from "@/lib/types";

type LoginType = "employee" | "admin";
type AccountMode = "idle" | "checking" | "login" | "create";

export default function LoginForm() {
  const router = useRouter();
  const [loginType, setLoginType] = useState<LoginType>("employee");
  const [role, setRole] = useState<EmployeeRole>("host");
  const [employeeId, setEmployeeId] = useState("");
  const [hosts, setHosts] = useState<SchedulePerson[]>([]);
  const [supports, setSupports] = useState<SchedulePerson[]>([]);
  const [peopleLoading, setPeopleLoading] = useState(true);
  const [accountMode, setAccountMode] = useState<AccountMode>("idle");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const people = role === "host" ? hosts : supports;
  const selectedPerson = people.find((person) => person.id === employeeId);

  useEffect(() => {
    let active = true;
    void fetch("/api/people", { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json()) as PeoplePayload;
        if (!response.ok || !payload.success) {
          throw new Error(payload.message || payload.error || "Không tải được danh sách nhân viên.");
        }
        if (active) {
          setHosts(payload.hosts || []);
          setSupports(payload.supports || []);
        }
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Không tải được danh sách nhân viên.");
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
      return;
    }

    let active = true;
    setAccountMode("checking");
    setError("");
    setPassword("");
    setConfirmPassword("");
    void fetch("/api/login/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, employeeId })
    })
      .then(async (response) => {
        const payload = (await response.json()) as { success?: boolean; hasPassword?: boolean; message?: string };
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
    setAccountMode(nextType === "admin" ? "login" : "idle");
  }

  function chooseRole(nextRole: EmployeeRole) {
    setRole(nextRole);
    setEmployeeId("");
    setAccountMode("idle");
    setError("");
    setPassword("");
    setConfirmPassword("");
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
        <button aria-selected={loginType === "employee"} className={loginType === "employee" ? "active" : ""} onClick={() => chooseLoginType("employee")} role="tab" type="button">Nhân viên</button>
        <button aria-selected={loginType === "admin"} className={loginType === "admin" ? "active" : ""} onClick={() => chooseLoginType("admin")} role="tab" type="button">Admin</button>
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
              <option value="">{peopleLoading ? "Đang tải danh sách..." : `Chọn ${role === "host" ? "host" : "support"}`}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.id}{person.level ? ` · ${person.level}` : ""}</option>
              ))}
            </select>
          </label>
          {selectedPerson && accountMode !== "checking" ? (
            <div className={`accountModeHint ${accountMode === "create" ? "newAccount" : "existingAccount"}`}>
              <strong>{selectedPerson.name}</strong>
              <span>{accountMode === "create" ? "Chưa có mật khẩu · Tạo mật khẩu lần đầu" : "Tài khoản đã có mật khẩu · Đăng nhập"}</span>
            </div>
          ) : null}
          {accountMode === "checking" ? <p className="formStatus">Đang kiểm tra tài khoản...</p> : null}
        </>
      ) : (
        <div className="accountModeHint adminAccount">
          <strong>Quản trị viên</strong>
          <span>Toàn quyền cập nhật lịch và xác nhận ca</span>
        </div>
      )}

      <label>
        {accountMode === "create" ? "Tạo mật khẩu" : "Mật khẩu"}
        <input
          autoComplete={accountMode === "create" ? "new-password" : "current-password"}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Tối thiểu 8 ký tự"
          minLength={8}
          disabled={loginType === "employee" && accountMode !== "login" && accountMode !== "create"}
          required
        />
      </label>
      {accountMode === "create" ? (
        <label>
          Nhập lại mật khẩu
          <input
            autoComplete="new-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Nhập lại mật khẩu mới"
            minLength={8}
            required
          />
        </label>
      ) : null}

      {error ? <p className="formError" aria-live="polite">{error}</p> : null}
      <button className="loginSubmit" type="submit" disabled={loading || (loginType === "employee" && (peopleLoading || !employeeId || (accountMode !== "login" && accountMode !== "create")))}>
        {loading ? "Đang xử lý..." : accountMode === "create" ? "Tạo mật khẩu và đăng nhập" : "Đăng nhập"}
      </button>
    </form>
  );
}
