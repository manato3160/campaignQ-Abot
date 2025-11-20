This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## 環境変数の設定

Vercelの環境変数に以下の値を設定してください：

### Slack関連

- **`SLACK_SIGNING_SECRET`**: Slack AppのSigning Secret
  - 取得方法: [Slack App管理画面](https://api.slack.com/apps) → 対象のApp → Basic Information → App Credentials → Signing Secret

- **`SLACK_BOT_TOKEN`**: Slack Bot Token（`xoxb-`で始まる）
  - 取得方法: [Slack App管理画面](https://api.slack.com/apps) → 対象のApp → OAuth & Permissions → Bot User OAuth Token

### Dify関連

- **`DIFY_API_URL`**: Dify APIのベースURL
  - 例: `https://api.dify.ai` または `https://your-dify-instance.com`
  - 注意: 末尾のスラッシュ（`/`）は不要です

- **`DIFY_API_KEY`**: Dify APIキー
  - 取得方法: Difyの管理画面 → Settings → API Keys → 新しいAPIキーを作成

- **`DIFY_WORKFLOW_ID`**: 実行するワークフローのID
  - **取得方法**:
    1. Difyの管理画面にログイン
    2. 対象のワークフローを開く
    3. ワークフローの詳細ページのURLを確認
    4. URLに含まれるIDをコピー
       - 例: `https://your-dify-instance.com/workflows/12345678-1234-1234-1234-1234567890ab` の場合
       - ワークフローIDは: `12345678-1234-1234-1234-1234567890ab`
    5. または、ワークフローの設定画面でAPIエンドポイントを確認
       - エンドポイント例: `/v1/workflows/12345678-1234-1234-1234-1234567890ab/run`
       - この場合、ワークフローIDは: `12345678-1234-1234-1234-1234567890ab`

- **`DIFY_API_VERSION`**: APIバージョン（**オプション**）
  - デフォルト値: `v1`
  - 通常は設定不要です。DifyのAPIエンドポイントが `/v1/workflows/...` の形式の場合は設定不要
  - もし `/workflows/...` のようにバージョンが含まれていない場合は、この変数を**空文字列**に設定してください
  - 例: `v1` または空文字列（設定しない場合はデフォルトで`v1`が使用されます）

### 設定例

Vercelの環境変数設定画面で以下のように設定します：

```
SLACK_SIGNING_SECRET=your_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
DIFY_API_URL=https://api.dify.ai
DIFY_API_KEY=app-your-api-key-here
DIFY_WORKFLOW_ID=12345678-1234-1234-1234-1234567890ab
DIFY_API_VERSION=v1
```

または、`DIFY_API_VERSION`を設定しない場合（デフォルトの`v1`を使用）：

```
SLACK_SIGNING_SECRET=your_signing_secret_here
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
DIFY_API_URL=https://api.dify.ai
DIFY_API_KEY=app-your-api-key-here
DIFY_WORKFLOW_ID=12345678-1234-1234-1234-1234567890ab
```
