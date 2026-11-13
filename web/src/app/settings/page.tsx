import Link from "next/link";
import { PreferencesForm } from "@/components/preferences-form";

export default function SettingsPage() {
  return (
    <main className="settings-page">
      <header className="settings-topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">沐</span>
          <span>
            <strong>分潤內容工作室</strong>
            <small>CONTENT STUDIO</small>
          </span>
        </Link>
        <Link className="back-link" href="/">
          ← 回到商品選品
        </Link>
      </header>
      <div className="settings-content">
        <div className="settings-breadcrumb">工作空間　/　內容偏好</div>
        <PreferencesForm />
      </div>
    </main>
  );
}
