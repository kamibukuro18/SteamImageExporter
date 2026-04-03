# Steam Image Exporter

Steam 用の主要画像セットをまとめて生成するデスクトップアプリです。キーアートを読み込み、必要に応じてロゴを重ね、Steam 向けの各サイズを一括で出力します。

## Main Features

- Key art から Steam 用画像を一括生成
- ロゴ画像のドラッグ&ドロップ対応
- ロゴ背景透過の自動処理
- テンプレート別のロゴ配置プレビュー
- 出力前のプリフライトチェック
- 作者情報 / 他ツール / 支援導線を `Info` に集約
- GitHub Releases ベースの更新確認

## Info / Updates

アプリ右上の `Info` から以下を確認できます。

- 作者情報
- GitHub プロフィール / リポジトリへの導線
- More Tools / Support への導線
- 最新リリース情報

更新情報は GitHub Releases API を使って取得します。
アプリ起動時に静かに確認し、より新しいバージョンがある場合のみ `Info` ボタン横に小さく `NEW` を表示します。

## Metadata / Version Management

設定値は `src/config/app-metadata.json` に集約しています。

含まれる内容:

- app name
- app version
- author name
- profile url
- gumroad / support url
- github repo url
- github releases api url
- github releases page url

ビルド前に `npm run sync:metadata` が走り、以下へバージョンとアプリ名を同期します。

- `package.json`
- `package-lock.json`
- `src-tauri/tauri.conf.json`

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run tauri build
```

## Release Operations

今後の配布と更新確認は GitHub Releases ベースを前提にします。

運用手順:

1. `src/config/app-metadata.json` の `appVersion` を更新
2. 必要なら作者リンクやリリース URL を更新
3. `npm run build` で動作確認
4. GitHub にタグ付きで push する、または Actions から各 OS 向けビルドを作る
5. GitHub Releases を作成し、タイトルと本文を記載する
6. アプリ内の `Info` > `Updates` から最新リリース内容を確認できる

## Notes

- 外部リンクは既定ブラウザで開きます
- 更新取得に失敗しても、通常の画像生成機能はそのまま使えます
- 自動アップデーター、ログイン、課金認証は含みません
