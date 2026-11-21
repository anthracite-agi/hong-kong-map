# 香港智慧城市地圖

一幅可互動的香港地圖。底圖用 [OpenFreeMap](https://openfreemap.org/) 的免費公開服務。地圖上有十條港鐵重鐵綫，點車站可看即將到站的班次；也有運輸署的交通快拍點，點選可看該處最新照片。

## 本地運行

```bash
npm install
npm run check
npm run dev
```

開發網站在 <http://127.0.0.1:5197>。

```bash
npm run build
npm run preview
```

`preview` 用來查看建置後的靜態網站，同樣使用 5197 端口。

## 資料

- 底圖：OpenFreeMap Liberty 樣式。免註冊、免 API 金鑰。
- 到站班次：港鐵實時列車服務資訊，`https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php`。只在點選車站時查詢，同一站 10 秒內重用結果。
- 路綫和車站名稱：港鐵「路綫及車站」CSV。馬場站不在這份表內，但到站接口有這個站，所以地圖有把它畫上。
- 車站位置：OpenStreetMap，對上港鐵站名。路綫是站與站的連線，不是路軌中心線。
- 交通快拍：運輸署位置檔，共 1013 點。照片由瀏覽器直接向 `tdcctv.data.one.gov.hk` 讀取。

輕鐵、港鐵巴士和高鐵不在上述到站接口內，所以這幅地圖不把它們畫成可查班次的站。

畫面上會註明資料來源。本網站並非港鐵或香港特別行政區政府的官方服務。

## 正式發佈

驗收通過之後，才發佈到 Cloudflare Workers 免費方案，使用帳戶自帶的 `workers.dev` 網址。這個設定沒有 Worker 程式，頁面屬靜態資源。Cloudflare 的靜態資源請求免費，而且不計入每日 10 萬次程式請求上限。

發佈前先在自己的免費帳戶登入，不要把 API 權杖貼到對話或檔案裡：

```bash
npm run build
npx wrangler deploy
```

預計費用是 0 美元。不買網域，也不使用 KV、D1 或 R2。
