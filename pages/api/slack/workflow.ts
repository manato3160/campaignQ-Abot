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

  console.log('[Dify] Configuration check:', {
    hasApiUrl: !!difyApiUrl,
    apiUrlPreview: difyApiUrl ? `${difyApiUrl.substring(0, 30)}...` : 'NOT SET',
    hasApiKey: !!difyApiKey,
    apiKeyPreview: difyApiKey ? `${difyApiKey.substring(0, 10)}...` : 'NOT SET',
  });

  if (!difyApiUrl || !difyApiKey) {
    const missing = [];
    if (!difyApiUrl) missing.push('DIFY_API_URL');
    if (!difyApiKey) missing.push('DIFY_API_KEY');
    console.error('[Dify] Configuration missing:', missing);
    throw new Error(`Dify configuration is missing: ${missing.join(', ')}`);
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

  console.log('[Dify] Calling Chat Flow API:', {
    endpoint,
    inputsCount: Object.keys(inputs).length,
    queryLength: query.length,
    inputKeys: Object.keys(inputs),
    queryPreview: query.substring(0, 200),
    requestBody: JSON.stringify(requestBody, null, 2),
  });

  const requestStartTime = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${difyApiKey.substring(0, 10)}...`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    const requestElapsedTime = Date.now() - requestStartTime;
    console.log('[Dify] Request completed:', {
      status: response.status,
      statusText: response.statusText,
      elapsedTime: `${requestElapsedTime}ms`,
      headers: Object.fromEntries(response.headers.entries()),
    });
  } catch (fetchError) {
    console.error('[Dify] Fetch error:', {
      error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      stack: fetchError instanceof Error ? fetchError.stack : undefined,
      endpoint,
    });
    throw new Error(`Failed to call Dify API: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[Dify] API error response:', {
      status: response.status,
      statusText: response.statusText,
      errorText,
      endpoint,
    });
    throw new Error(`Dify API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  console.log('[Dify] API response received:', {
    hasAnswer: !!data.answer,
    answerLength: data.answer?.length || 0,
    answerPreview: data.answer?.substring(0, 200) || 'N/A',
    responseKeys: Object.keys(data),
    fullResponse: JSON.stringify(data, null, 2).substring(0, 500),
  });
  
  // チャットフローAPIのレスポンスはdata.answerに含まれる
  const answer = data.answer || JSON.stringify(data);
  console.log('[Dify] Returning answer:', {
    length: answer.length,
    preview: answer.substring(0, 200),
  });
  return answer;
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
  // 最初に必ずログを出力（リクエストが到達しているか確認）
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  console.log(`[Workflow-${requestId}] ====== REQUEST RECEIVED ======`);
  console.log(`[Workflow-${requestId}] Endpoint: /api/slack/workflow`);
  console.log(`[Workflow-${requestId}] Request received:`, {
    method: req.method,
    url: req.url,
    path: req.url,
    timestamp: new Date().toISOString(),
    headers: {
      'content-type': req.headers['content-type'],
      'x-slack-request-timestamp': req.headers['x-slack-request-timestamp'],
      'x-slack-signature': req.headers['x-slack-signature'] ? 'present' : 'missing',
      'user-agent': req.headers['user-agent'],
      'host': req.headers['host'],
    },
  });

  if (req.method !== 'POST') {
    console.log(`[Workflow-${requestId}] Method not allowed:`, req.method);
    console.log(`[Workflow-${requestId}] Expected POST, got ${req.method}`);
    console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (405) ======`);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    console.log(`[Workflow-${requestId}] Reading request body...`);
    const rawBody = await getRawBody(req);
    console.log(`[Workflow-${requestId}] Raw body received:`, {
      length: rawBody.length,
      preview: rawBody.substring(0, 200),
    });
    
    if (!rawBody) {
      console.error(`[Workflow-${requestId}] Empty request body`);
      console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (400) ======`);
      return res.status(400).json({ error: 'Empty request body' });
    }

    let body;
    try {
      body = JSON.parse(rawBody);
      console.log(`[Workflow-${requestId}] Parsed body:`, {
        keys: Object.keys(body),
        type: body.type,
        hasInputs: !!body.inputs,
        inputsKeys: body.inputs ? Object.keys(body.inputs) : [],
      });
    } catch (parseError) {
      console.error(`[Workflow-${requestId}] Failed to parse JSON:`, parseError);
      console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (400) ======`);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Slack URL verification (challenge) - 署名検証の前に処理
    if (body.type === 'url_verification') {
      console.log(`[Workflow-${requestId}] URL verification challenge received`);
      if (!body.challenge) {
        console.error(`[Workflow-${requestId}] Missing challenge parameter`);
        console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (400) ======`);
        return res.status(400).json({ error: 'Missing challenge parameter' });
      }
      // challengeの値をそのままプレーンテキストで返す（Slackの仕様）
      console.log(`[Workflow-${requestId}] Returning challenge:`, body.challenge);
      console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (200 - Challenge) ======`);
      return res.status(200).send(body.challenge);
    }

    // 署名検証（Slackワークフローからのリクエストには署名がない場合もある）
    const timestamp = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    if (timestamp && signature) {
      console.log('[Workflow] Verifying signature...');
      const basestring = `v0:${timestamp}:${rawBody}`;
      const signingSecret = process.env.SLACK_SIGNING_SECRET;

      if (!signingSecret) {
        console.error('[Workflow] SLACK_SIGNING_SECRET is not set');
        return res.status(500).json({ error: 'Server configuration error' });
      }

      const mySignature = `v0=` + crypto.createHmac('sha256', signingSecret)
        .update(basestring, 'utf8')
        .digest('hex');

      if (mySignature !== signature) {
        console.error('[Workflow] Signature verification failed:', {
          expected: signature.substring(0, 20) + '...',
          actual: mySignature.substring(0, 20) + '...',
        });
        return res.status(401).json({ error: 'Verification failed' });
      }
      console.log('[Workflow] Signature verified successfully');
    } else {
      console.log('[Workflow] No signature headers found, skipping verification (may be from Slack Workflow)');
    }

    console.log('[Workflow] Request validated, starting background process:', {
      hasInputs: !!body.inputs,
      hasChannel: !!body.channel,
      hasUserId: !!body.user_id,
      bodyKeys: Object.keys(body),
      inputsKeys: body.inputs ? Object.keys(body.inputs) : [],
    });

    // 即座に200を返す
    res.status(200).json({ ok: true });
    console.log('[Workflow] Response sent, background process will continue');

    // バックグラウンド処理
    const backgroundProcess = (async () => {
      const processStartTime = Date.now();
      console.log('[Workflow] Background process started at:', new Date().toISOString());
      
      try {
        // Slackワークフローからのデータ構造を確認
        // body.inputs に各フィールドが含まれている想定
        // または body のトップレベルに各フィールドが含まれている可能性もある
        
        // まず、body.inputs から取得を試みる
        const workflowInputs = body.inputs || body;
        console.log('[Workflow] Extracting inputs from:', {
          source: body.inputs ? 'body.inputs' : 'body',
          keys: Object.keys(workflowInputs),
        });
        
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

        console.log('[Workflow] Processing workflow with inputs:', {
          totalFields: Object.keys(inputs).length,
          nonEmptyFields: Object.keys(filteredInputs).length,
          inputKeys: Object.keys(filteredInputs),
          filteredInputs: filteredInputs,
        });

        if (Object.keys(filteredInputs).length === 0) {
          console.warn('[Workflow] No input fields found, sending default query');
        }

        // DifyチャットフローAPIを呼び出し（空でないフィールドのみを渡す）
        console.log('[Workflow] Calling Dify API...');
        const difyResponse = await callDifyChatFlow(filteredInputs);
        console.log('[Workflow] Dify API response received:', {
          responseLength: difyResponse.length,
          preview: difyResponse.substring(0, 100),
        });

        // Slackに結果を投稿
        const channel = body.channel || body.inputs?.channel;
        console.log('[Workflow] Posting to Slack channel:', channel);
        await postSlackMessage(
          channel,
          `📋 *肥田さんへの質問の回答*\n\n${difyResponse}\n\n_質問者: <@${body.user_id}>_`
        );

        const elapsedTime = Date.now() - processStartTime;
        console.log('[Workflow] Workflow processed successfully', {
          elapsedTime: `${elapsedTime}ms`,
        });
      } catch (error) {
        const elapsedTime = Date.now() - processStartTime;
        console.error('[Workflow] Error processing workflow:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          elapsedTime: `${elapsedTime}ms`,
        });
        
        // エラーをSlackに通知
        try {
          const channel = body.channel || body.inputs?.channel;
          console.log('[Workflow] Posting error to Slack channel:', channel);
          await postSlackMessage(
            channel,
            `❌ エラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        } catch (slackError) {
          console.error('[Workflow] Failed to post error to Slack:', slackError);
        }
      }
    })();

    console.log(`[Workflow-${requestId}] Calling waitUntil...`);
    waitUntil(backgroundProcess);
    console.log(`[Workflow-${requestId}] waitUntil called, handler will return`);
    console.log(`[Workflow-${requestId}] ====== HANDLER RETURNING ======`);

  } catch (error) {
    console.error(`[Workflow-${requestId}] ====== TOP LEVEL ERROR ======`);
    console.error(`[Workflow-${requestId}] Error processing workflow request:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.log(`[Workflow-${requestId}] ====== REQUEST ENDED (500) ======`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}