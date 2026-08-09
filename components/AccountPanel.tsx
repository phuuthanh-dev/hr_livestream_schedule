"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

type ManagedAccount = {
  accountKey: string;
  displayName: string;
  role: "host" | "support";
  employeeId: string;
  locked: boolean;
};

type AccountPanelProps = {
  isAdmin: boolean;
  username: string;
  onClose: () => void;
};

type AdminAction = "reset_password" | "lock" | "unlock" | "revoke_sessions";

export default function AccountPanel({ isAdmin, username, onClose }: AccountPanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(isAdmin);
  const [busyAccountKey, setBusyAccountKey] = useState("");
  const [resetAccountKey, setResetAccountKey] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function loadAccounts() {
    if (!isAdmin) return;
    setAccountsLoading(true);
    try {
      const response = await fetch("/api/admin/accounts", { cache: "no-store" });
      const payload = (await response.json()) as {
        success?: boolean;
        accounts?: ManagedAccount[];
        message?: string;
      };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không tải được tài khoản.");
      setAccounts(payload.accounts || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không tải được tài khoản.");
    } finally {
      setAccountsLoading(false);
    }
  }

  useEffect(() => {
    void loadAccounts();
  }, [isAdmin]);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChangingPassword(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/account/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      const payload = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không đổi được mật khẩu.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage(payload.message || "Đã đổi mật khẩu.");
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Không đổi được mật khẩu.");
    } finally {
      setChangingPassword(false);
    }
  }

  async function runAdminAction(account: ManagedAccount, action: AdminAction) {
    if (action !== "reset_password") {
      const actionLabel = action === "lock" ? "khóa tài khoản" : action === "unlock" ? "mở khóa tài khoản" : "đăng xuất khỏi mọi thiết bị";
      if (!window.confirm(`Xác nhận ${actionLabel} của ${account.displayName}?`)) return;
    }

    setBusyAccountKey(account.accountKey);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          accountKey: account.accountKey,
          newPassword: action === "reset_password" ? resetPassword : undefined,
          confirmPassword: action === "reset_password" ? resetConfirmation : undefined
        })
      });
      const payload = (await response.json()) as { success?: boolean; message?: string };
      if (!response.ok || !payload.success) throw new Error(payload.message || "Không cập nhật được tài khoản.");
      setMessage(payload.message || "Đã cập nhật tài khoản.");
      setResetAccountKey("");
      setResetPassword("");
      setResetConfirmation("");
      await loadAccounts();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Không cập nhật được tài khoản.");
    } finally {
      setBusyAccountKey("");
    }
  }

  return (
    <div className="accountModalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="accountModal" role="dialog" aria-modal="true" aria-label="Quản lý tài khoản">
        <header className="accountModalHeader">
          <div>
            <span>TÀI KHOẢN</span>
            <h2>{username}</h2>
            <p>{isAdmin ? "Quản trị viên" : "Nhân viên"}</p>
          </div>
          <button className="accountCloseButton" aria-label="Đóng quản lý tài khoản" onClick={onClose} type="button">×</button>
        </header>

        {error ? <p className="accountNotice error" aria-live="polite">{error}</p> : null}
        {message ? <p className="accountNotice success" aria-live="polite">{message}</p> : null}

        <form className="passwordChangeForm" onSubmit={changePassword}>
          <div className="accountSectionHeading">
            <strong>Đổi mật khẩu của tôi</strong>
            <span>Mật khẩu không được rỗng và tối đa 72 byte.</span>
          </div>
          <label>Mật khẩu hiện tại<input autoComplete="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label>Mật khẩu mới<input autoComplete="new-password" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label>Nhập lại mật khẩu mới<input autoComplete="new-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          <button className="accountPrimaryButton" disabled={changingPassword} type="submit">{changingPassword ? "Đang đổi..." : "Đổi mật khẩu"}</button>
        </form>

        {isAdmin ? (
          <section className="employeeAccountManager">
            <div className="accountSectionHeading">
              <strong>Tài khoản nhân viên</strong>
              <span>Reset, khóa hoặc thu hồi mọi phiên đăng nhập.</span>
            </div>
            {accountsLoading ? <p className="accountEmptyState">Đang tải tài khoản...</p> : null}
            {!accountsLoading && accounts.length === 0 ? <p className="accountEmptyState">Chưa có tài khoản nhân viên nào được tạo.</p> : null}
            <div className="managedAccountList">
              {accounts.map((account) => (
                <article className={`managedAccount ${account.locked ? "locked" : ""}`} key={account.accountKey}>
                  <div className="managedAccountIdentity">
                    <span className="managedAccountAvatar">{account.displayName.slice(0, 1).toUpperCase()}</span>
                    <div><strong>{account.displayName}</strong><span>{account.role === "host" ? "Host" : "Support Live"} · {account.employeeId}</span></div>
                    <em>{account.locked ? "Đã khóa" : "Hoạt động"}</em>
                  </div>
                  <div className="managedAccountActions">
                    <button onClick={() => setResetAccountKey((current) => current === account.accountKey ? "" : account.accountKey)} type="button">Đặt mật khẩu mới</button>
                    <button onClick={() => void runAdminAction(account, "revoke_sessions")} disabled={busyAccountKey === account.accountKey} type="button">Đăng xuất tất cả</button>
                    <button className={account.locked ? "unlock" : "danger"} onClick={() => void runAdminAction(account, account.locked ? "unlock" : "lock")} disabled={busyAccountKey === account.accountKey} type="button">{account.locked ? "Mở khóa" : "Khóa"}</button>
                  </div>
                  {resetAccountKey === account.accountKey ? (
                    <div className="adminResetForm">
                      <label>Mật khẩu mới<input autoComplete="new-password" type="password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
                      <label>Nhập lại<input autoComplete="new-password" type="password" value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} /></label>
                      <button className="accountPrimaryButton" onClick={() => void runAdminAction(account, "reset_password")} disabled={busyAccountKey === account.accountKey || !resetPassword || !resetConfirmation} type="button">Reset và đăng xuất tất cả</button>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
