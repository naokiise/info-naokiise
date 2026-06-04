# Naoki Ise — Portfolio (Astro)

[info.naokiise.com](https://info.naokiise.com/) を Notion Super なしで再実装した Astro サイトです。

## 開発

```bash
npm install
npm run dev
```

http://localhost:4321 でプレビューできます。

## ビルド

```bash
npm run build
npm run preview
```

## 構成

- `src/pages/index.astro` — トップページ
- `src/data/site.json` — 作品・実績データ
- `src/components/` — UI コンポーネント
- `src/styles/global.css` — Notion 風スタイル

## データ更新

`src/data/site.json` を編集して保存すると、開発サーバーが自動で反映します。
