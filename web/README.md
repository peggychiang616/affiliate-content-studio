# 分潤內容工作室（Affiliate Content Studio）

響應式 Web MVP。商品來源、素材權利、生成／配音／渲染服務尚未通過 V0 驗證前，應用不得把商品或輸出呈現為已授權或可正式使用。

## 本機開發

需要 Node.js 20.9 以上與 npm。

```bash
npm install
npm run dev
```

開啟 [http://localhost:3000](http://localhost:3000)。

首頁提供不需資料庫、登入或 API Key 的本機展示流程：選取合成商品、設定內容偏好，並查看明確標示為模擬輸出的推薦理由與文案。商品及分潤數字均為示意，不是實際平台資料。偏好只保存在目前瀏覽器。其他正式製作 API 仍保留原本的資格與服務檢查。

商品清單支援關鍵字搜尋與品類篩選；可查看商品詳情、在本機回看最近預覽，並複製或下載模擬文案。這些操作不會連接電商平台或建立正式批次。

## 驗證

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## PostgreSQL

資料庫結構以 `db/migrations/` 的遞增 SQL 遷移管理。應用程式只在伺服器端連線；不可將資料庫憑證提交至版本控制。首次遷移只建立遷移版本表，產品資料與工作流程遷移會隨功能逐步新增。

設定 `DATABASE_URL` 後，在 `web/` 目錄執行 `npm run db:migrate` 套用尚未執行的遷移。遷移逐檔交易執行，失敗時會回滾並以非零狀態結束。

內容偏好與批次 API 目前只接受明確設定的本機示範身分：`NODE_ENV=development`、`APP_MODE=demo`，以及合法 UUID 格式的 `DEMO_PRINCIPAL_ID`。其他環境一律回應未授權；此示範身分不是登入或存取控制方案，不得用於正式使用者試行。正式環境須先接上已核准的身分驗證 adapter。

身分來源透過 `src/lib/auth/principal.ts` 的 `PrincipalResolver` 介面注入；目前沒有註冊正式 provider，因此 production 預設 fail closed。

## 內容批次 API

`POST /api/batches` 接受 `{ "productIds": ["..."] }`，並要求 `Idempotency-Key` 請求標頭。每批最多可選 3 個商品；伺服器會重新檢查商品資料與素材權利，並以目前已保存的偏好版本建立最多 6 個內容組及各自的持久工作記錄。以相同使用者和冪等鍵重送會回傳既有批次，不會重複建立群組、工作或批次事件。沒有已保存偏好、未就緒商品或不可用身分時，批次不會建立。

`POST /api/content-groups/{groupId}/generate` 執行一組排隊工作。系統只把目前商品來源版本的已核實事實交給文字 adapter，且只採用 adapter 回傳的有效事實鍵；貼文、腳本與字幕由這些已核對事實組成。內容版本保存來源事實及偏好版本快照，`provider_usage_events` 則逐工作記錄成功用量／成本或明確標記未知成本的失敗。

`/production` 與 `GET /api/content-groups` 提供逐組預覽及工作歷史。對待審閱版本使用 `PATCH /api/content-groups/{groupId}/revisions/{revisionId}` 保存文字／風格變更；變更會追加新版本。`POST /api/content-groups/{groupId}/regenerate` 產生新版本，`POST /api/content-groups/{groupId}/retry` 只接受失敗組，兩者均需 `Idempotency-Key`，並保留各次工作狀態及可讀失敗原因。

## 短片預覽、確認與匯出

`POST /api/content-groups/{groupId}/render` 僅接受待審閱的最新版本，並在伺服器重新檢查商品來源與素材權利；只有通過 MP4 驗證且使用正式 provider 的結果才會保存。`POST /api/content-groups/{groupId}/preview` 會在可用時簽發短效私有影片連結並記錄預覽時間。使用者須在預覽連結有效的 5 分鐘內明確確認，才能呼叫 `POST /api/content-groups/{groupId}/confirm`；確認與匯出請求均需 `Idempotency-Key`。

`POST /api/content-groups/{groupId}/export` 會再次驗證商品事實、資料新鮮度、素材權利與影片輸出，提供含聯盟行銷揭露的貼文及短效影片下載連結。匯出只提供檔案，沒有自動發布操作。正式媒體儲存簽署器與生成／配音／渲染 provider 尚未核准或設定，因此目前預覽及下載會明確失敗，不會回傳佔位影片或公開媒體 URI。

## 外部服務與測試資料

只有在 V0 核實 API 可用性、條款、素材授權及成本後，才可設定正式服務。開發測試資料必須明確標示為合成資料，不得假稱為電商平台資料或已授權素材。正式使用者試行前，還必須完成驗證與刪除政策、存取控制及資料保留設定。

複製 `.env.example` 作為本機環境設定的參考。每個 provider 都必須同時設定 provider ID，並將 `V0_<整合名稱>_ACCESS_VERIFIED`、`RIGHTS_VERIFIED`、`TERMS_VERIFIED` 與 `COST_VERIFIED` 全部設為 `true`，才能通過應用層 readiness gate。這些旗標是 V0 審核紀錄，不會自動驗證供應商；不得在未完成實際審核時啟用。

即使 readiness gate 通過，也必須在 `src/lib/products/catalog.ts` 註冊並實作正式商品來源 adapter，才可改用正式來源；目前尚未註冊，因此誤設完整 V0 旗標時會明確失敗，不會退回合成資料。正式 adapter 必須回傳商品來源／版本、有效期限、逐項有來源的事實、素材來源及明確權利範圍；只有就緒檢查通過的商品才能進入選品狀態。

`src/lib/providers/adapters.ts` 的文字、配音與渲染目前也只有明確標記為合成的示範 adapter；V0 旗標通過不代表已有正式服務。正式環境須同時具備全部 provider readiness 證據及 provider ID 相符的正式 adapter，否則請求會明確失敗；adapter 呼叫亦有逾時限制，不會以示範輸出冒充成功結果。

影片模板只接受通過商品與素材權利檢查的原商品素材，配音語系固定為 `zh-TW`，字幕會限制在安全區域並以 1080×1920、20 秒 MP4 作為渲染目標。渲染輸出必須通過可播放性、格式、15–30 秒長度、尺寸、音訊、字幕安全區及同步檢查；目前合成 renderer 明確不合格，不能作為可預覽或匯出的正式影片。
