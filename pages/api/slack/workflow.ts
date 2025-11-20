import type { NextApiRequest, NextApiResponse } from 'next';
import * as crypto from 'crypto';
import { waitUntil } from '@vercel/functions';

export const config = {
  api: {
    bodyParser: false,
  },
};

// リクエストボディを読み取るヘルパー関数
function getRawBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk.toString();
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

// DifyチャットフローAPIを呼び出す関数
async function callDifyChatFlow(inputs: Record<string, string>): Promise<string> {
  const difyApiUrl = process.env.DIFY_API_URL;
  const difyApiKey = process.env.DIFY_API_KEY;

  if (!difyApiUrl || !difyApiKey) {
    throw new Error('Dify configuration is missing');
  }

  let baseUrl = difyApiUrl.trim();
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }

  const hasVersionInUrl = /\/v\d+$/.test(baseUrl);
  let endpoint: string;
  
  // チャットフローAPIを使用（/chat-messagesエンドポイント）
  if (hasVersionInUrl) {
    endpoint = `${baseUrl}/chat-messages`;
  } else {
    const apiVersion = process.env.DIFY_API_VERSION || 'v1';
    endpoint = `${baseUrl}/${apiVersion}/chat-messages`;
  }

  // チャットフローでは、全ての入力フィールドをqueryに結合して送信
  // 空の値を除外して、見やすい形式で結合
  const queryParts = Object.entries(inputs)
    .filter(([_, value]) => value && value.trim() !== '')
    .map(([key, value]) => `${key}: ${value}`);

  const query = queryParts.length > 0 
    ? queryParts.join('\n')
    : '質問があります';

  const requestBody = {
    query: query,
    inputs: {}, // チャットフローではinputsは空でOK
    response_mode: 'blocking',
    user: 'slack-workflow',
  };

  console.log('Calling Dify Chat Flow API:', {
    endpoint,
    inputsCount: Object.keys(inputs).length,
    queryLength: query.length,
    inputKeys: Object.keys(inputs),
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${difyApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Dify API error:', {
      status: response.status,
      errorText,
      endpoint,
    });
    throw new Error(`Dify API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  // チャットフローAPIのレスポンスはdata.answerに含まれる
  return data.answer || JSON.stringify(data);
}

// Slackにメッセージを投稿する関数
async function postSlackMessage(
  channel: string,
  text: string,
  threadTs?: string
): Promise<void> {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  if (!slackBotToken) {
    throw new Error('SLACK_BOT_TOKEN is not set');
  }

  const payload: {
    channel: string;
    text: string;
    thread_ts?: string;
  } = {
    channel,
    text,
  };

  if (threadTs) {
    payload.thread_ts = threadTs;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${slackBotToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const rawBody = await getRawBody(req);
    
    if (!rawBody) {
      return res.status(400).json({ error: 'Empty request body' });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // 署名検証
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    if (!timestamp || !signature) {
      return res.status(401).json({ error: 'Missing required headers' });
    }

    const basestring = `v0:${timestamp}:${rawBody}`;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!signingSecret) {
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const mySignature = `v0=` + crypto.createHmac('sha256', signingSecret)
      .update(basestring, 'utf8')
      .digest('hex');

    if (mySignature !== signature) {
      return res.status(401).json({ error: 'Verification failed' });
    }

    console.log('Workflow request received:', {
      hasInputs: !!body.inputs,
      hasChannel: !!body.channel,
      hasUserId: !!body.user_id,
      bodyKeys: Object.keys(body),
      inputsKeys: body.inputs ? Object.keys(body.inputs) : [],
    });

    // 即座に200を返す
    res.status(200).json({ ok: true });

    // バックグラウンド処理
    const backgroundProcess = (async () => {
      try {
        // Slackワークフローからのデータ構造を確認
        // body.inputs に各フィールドが含まれている想定
        // または body のトップレベルに各フィールドが含まれている可能性もある
        
        // まず、body.inputs から取得を試みる
        const workflowInputs = body.inputs || body;
        
        // Difyのチャットフローに入力フィールドを渡す
        // 全ての入力フィールドをqueryに結合して送信する
        const inputs: Record<string, string> = {
          // 日本語フィールド名（Dify側で定義されている場合）
          '概要': workflowInputs['概要'] || workflowInputs.概要 || '',
          '当選者': workflowInputs.prize_winner || workflowInputs['当選者'] || '',
          '応募者情報抽出': workflowInputs.applicant_extravtion || workflowInputs['応募者情報抽出'] || '',
          '応募者選定情報': workflowInputs.applicant_select || workflowInputs['応募者選定情報'] || '',
          '個人情報管理': workflowInputs.personal_infomation || workflowInputs.personal_information || workflowInputs['個人情報管理'] || '',
          '問い合わせ内容': workflowInputs.inquiry_details || workflowInputs['問い合わせ内容'] || '',
          'DM送付': workflowInputs.send_dm || workflowInputs['DM送付'] || '',
          '発送対応': workflowInputs.shipping_correspo || workflowInputs['発送対応'] || '',
          'オプション': workflowInputs.option || workflowInputs['オプション'] || '',
          '商品カテゴリ': workflowInputs.product_category || workflowInputs['商品カテゴリ'] || '',
          '商品': workflowInputs.product || workflowInputs['商品'] || '',
        };

        // 空の値を除外（オプション）
        const filteredInputs: Record<string, string> = {};
        for (const [key, value] of Object.entries(inputs)) {
          if (value && value.trim() !== '') {
            filteredInputs[key] = value;
          }
        }

        console.log('Processing workflow with inputs:', {
          totalFields: Object.keys(inputs).length,
          nonEmptyFields: Object.keys(filteredInputs).length,
          inputKeys: Object.keys(filteredInputs),
          rawInputs: workflowInputs,
        });

        // DifyチャットフローAPIを呼び出し（空でないフィールドのみを渡す）
        const difyResponse = await callDifyChatFlow(filteredInputs);

        // Slackに結果を投稿
        await postSlackMessage(
          body.channel || body.inputs?.channel,
          `📋 *肥田さんへの質問の回答*\n\n${difyResponse}\n\n_質問者: <@${body.user_id}>_`
        );

        console.log('Workflow processed successfully');
      } catch (error) {
        console.error('Error processing workflow:', error);
        
        // エラーをSlackに通知
        try {
          await postSlackMessage(
            body.channel || body.inputs?.channel,
            `❌ エラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        } catch (slackError) {
          console.error('Failed to post error to Slack:', slackError);
        }
      }
    })();

    waitUntil(backgroundProcess);

  } catch (error) {
    console.error('Error processing workflow request:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}