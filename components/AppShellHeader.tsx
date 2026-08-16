"use client";

import type { ReactNode } from "react";

type AppShellHeaderProps = {
  title: string;
  username: string;
  className?: string;
  middleContent?: ReactNode;
  rightContent?: ReactNode;
  onOpenAccount: () => void;
  onLogout: () => void | Promise<void>;
};

function HeaderIcon({ name, size = 20 }: { name: "account" | "logout"; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "account") {
    return <svg {...common}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>;
  }

  return <svg {...common}><path d="M10 17l5-5-5-5M15 12H3M14 4h4a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-4" /></svg>;
}

export default function AppShellHeader({
  title,
  username,
  className,
  middleContent,
  rightContent,
  onOpenAccount,
  onLogout
}: AppShellHeaderProps) {
  return (
    <header className={`appHeader ${className || ""}`.trim()}>
      <div className="brandBlock">
        <span className="brandMark"><img className="brandLogo" src="/rr-logo-submark-square.png" alt="" /></span>
        <span className="brandName">{title}</span>
      </div>

      <div className="appHeaderMiddle">
        {middleContent}
      </div>

      <div className="headerActions">
        {rightContent}
        <span className="userAvatar" title={`Đăng nhập: ${username}`}>{username.slice(0, 1).toUpperCase()}</span>
        <button className="iconButton" aria-label="Quản lý tài khoản" onClick={onOpenAccount} type="button"><HeaderIcon name="account" /></button>
        <button className="iconButton" aria-label="Đăng xuất" onClick={() => void onLogout()} type="button"><HeaderIcon name="logout" /></button>
      </div>
    </header>
  );
}
