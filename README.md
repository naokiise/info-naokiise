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

リポジトリ: [github.com/naokiise/info-naokiise](https://github.com/naokiise/info-naokiise)

```bash
npm run deploy
```

`main` にソースを push し、`npm run deploy` で `gh-pages` ブランチへビルド成果物を公開します。

- カスタムドメイン: [info.naokiise.com](https://info.naokiise.com/)
- DNS: `info` の CNAME を `naokiise.github.io` に向ける（Super.so の CNAME は削除）
- GitHub → Settings → Pages → Custom domain に `info.naokiise.com` を設定

（`.github/workflows/deploy.yml` による自動デプロイも用意済み。`workflow` スコープ付きで push すれば `main` への push だけで公開できます。）

## 構成

- `src/pages/index.astro` — トップページ
- `src/data/site.json` — 作品・実績データ
- `src/components/` — UI コンポーネント
- `src/styles/global.css` — Notion 風スタイル

## データ更新

`src/data/site.json` を編集して保存すると、開発サーバーが自動で反映します。
