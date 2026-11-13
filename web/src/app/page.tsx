import Link from "next/link";
import { ProductCatalog } from "@/components/product-catalog";
import { getProductCatalog } from "@/lib/products/catalog";

export default function Home() {
  const catalog = getProductCatalog();

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="小幫手工作台首頁">
          <span className="brand-mark">沐</span>
          <span>
            <strong>分潤內容工作室</strong>
            <small>CONTENT STUDIO</small>
          </span>
        </Link>

        <div className="workspace-label">工作空間</div>
        <nav className="main-nav" aria-label="主要導覽">
          <a className="nav-item active" href="#products">
            <span className="nav-icon">▦</span>
            商品選品
          </a>
          <Link className="nav-item" href="/settings">
            <span className="nav-icon">⚙</span>
            內容偏好
          </Link>
          <Link className="nav-item" href="/production">
            <span className="nav-icon">✳</span>
            內容製作
          </Link>
          <a className="nav-item disabled" href="#calendar" aria-disabled="true">
            <span className="nav-icon">▤</span>
            七日安排
            <span className="nav-lock">稍後</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-icon">?</span>
            <div>
              <strong>先確認，再開始</strong>
              <p>商品資料與素材使用權通過檢查後，才會開放製作。</p>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">Peg</span>
            <div>
              <strong>體驗工作區</strong>
              <small>尚未連結商品來源</small>
            </div>
            <span className="profile-more">···</span>
          </div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>工作空間</span>
            <span className="breadcrumb-separator">/</span>
            <strong>商品選品</strong>
          </div>
          <div className="topbar-right">
            <span className="mode-pill">
              <span className="status-dot" />
              示意模式
            </span>
            <button className="icon-button" aria-label="通知">
              ♧
              <span className="notification-dot" />
            </button>
            <span className="top-avatar">P</span>
          </div>
        </header>

        <div className="content-wrap">
          <section className="welcome-row">
            <div>
              <div className="eyebrow">商品靈感 · 01</div>
              <h1>從好商品開始，<span>其他交給靈感。</span></h1>
              <p className="page-intro">
                選擇示意商品、設定分享偏好，立即體驗推薦理由與文案預覽。
              </p>
            </div>
            <div className="date-chip">
              <span className="date-icon">◷</span>
              <span>你的選品工作台</span>
            </div>
          </section>

          <section className="notice-banner" aria-label="商品來源狀態">
            <span className="notice-icon">i</span>
            <div>
              <strong>本機展示模式 · 商品與文案皆為模擬資料</strong>
              <p>
                可選取示意商品並完成內容預覽；不會連接電商平台，也不代表真實商品、分潤或素材授權。
              </p>
            </div>
            <span className="notice-status">本機流程可操作</span>
          </section>

          <div className="section-heading" id="products">
            <div>
              <div className="section-title-row">
                <h2>商品示意清單</h2>
                <span className="count-pill">{catalog.products.length} 個示意項目</span>
              </div>
              <p>選擇最多 3 個示意商品，再設定偏好並產生模擬推薦與文案。</p>
            </div>
          </div>

          <ProductCatalog products={catalog.products} />

          <section className="bottom-strip">
            <div className="bottom-strip-icon">✦</div>
            <div>
              <strong>每個內容主張，都要有來源</strong>
              <p>沒有核實的商品資訊或素材權利，系統不會開始製作。</p>
            </div>
            <span className="strip-link">了解安全製作原則 <span>↗</span></span>
          </section>

          <footer className="footer">
            <span>© 2026 分潤內容工作室</span>
            <span>讓分享更輕鬆，也更安心。</span>
            <a href="#privacy">隱私與資料使用</a>
          </footer>
        </div>
      </section>
    </main>
  );
}
