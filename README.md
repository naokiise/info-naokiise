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

## GitHub Pages 公開

`main` ブランチへの push で GitHub Actions がビルド・デプロイします。

- カスタムドメイン: [info.naokiise.com](https://info.naokiise.com/)
- DNS: `info` の CNAME を `naokiise.github.io` に向ける（Super.so の CNAME は削除）
- リポジトリ Settings → Pages → Custom domain に `info.naokiise.com` を設定

## 構成

- `src/pages/index.astro` — トップページ
- `src/data/site.json` — 作品・実績データ
- `src/components/` — UI コンポーネント
- `src/styles/global.css` — Notion 風スタイル

## データ更新

`src/data/site.json` を編集して保存すると、開発サーバーが自動で反映します。
