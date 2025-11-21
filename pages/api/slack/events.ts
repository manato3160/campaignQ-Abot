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
// YMLファイルの開始ノード(1763360367489)の変数名にマッピング
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

  // 日本語キー名をDifyチャットフローの変数名にマッピング
  // YMLファイルの開始ノード(1763360367489)の変数定義に基づく
  const variableMapping: Record<string, string> = {
    '当選者': 'prize_winner',
    '応募者情報抽出': 'applicant_extravtion', // YMLのtypoに合わせる
    '応募者選定情報': 'applicant_select',
    '個人情報管理': 'personal_infomation', // YMLのtypoに合わせる
    '問い合わせ内容': 'inquiry_details',
    'DM送付': 'send_dm',
    '発送対応': 'shipping_correspondence',
    'オプション': 'option',
    '商品カテゴリ': 'product_category',
    '商品': 'product',
    // 念のため、英語キーもそのまま使用可能にする
    'prize_winner': 'prize_winner',
    'applicant_extravtion': 'applicant_extravtion',
    'applicant_select': 'applicant_select',
    'personal_infomation': 'personal_infomation',
    'inquiry_details': 'inquiry_details',
    'send_dm': 'send_dm',
    'shipping_correspondence': 'shipping_correspondence',
    'option': 'option',
    'product_category': 'product_category',
    'product': 'product',
  };

  // 日本語キーを英語変数名に変換
  const difyInputs: Record<string, string> = {};
  for (const [key, value] of Object.entries(inputs)) {
    if (value && value.trim() !== '') {
      const variableName = variableMapping[key] || key;
      difyInputs[variableName] = value.trim();
      console.log(`[Dify] Mapping: "${key}" -> "${variableName}" = "${value.trim()}"`);
    }
  }

  // Dify Chat Flow APIのリクエストボディ
  // inputsパラメータに変数名と値をマッピング
  // queryパラメータは、ユーザーの質問テキスト（空でもOK、または要件をまとめたテキスト）
  const queryParts = Object.entries(difyInputs)
    .filter(([_, value]) => value && value.trim() !== '')
    .map(([key, value]) => `${key}: ${value}`);

  // queryは、要件をまとめたテキストとして使用（または空でもOK）
  const query = queryParts.length > 0 
    ? `キャンペーン要件:\n${queryParts.join('\n')}`
    : 'キャンペーン要件の見積もりをお願いします';

  const requestBody = {
    query: query,
    inputs: difyInputs, // Difyチャットフローの変数名と値をマッピング
    response_mode: 'blocking',
    user: 'slack-workflow',
  };

  console.log('[Dify] Calling Chat Flow API:', {
    endpoint,
    originalInputsCount: Object.keys(inputs).length,
    mappedInputsCount: Object.keys(difyInputs).length,
    queryLength: query.length,
    originalInputKeys: Object.keys(inputs),
    mappedInputKeys: Object.keys(difyInputs),
    mappedInputs: difyInputs,
    queryPreview: query.substring(0, 200),
    requestBody: JSON.stringify(requestBody, null, 2),
  });

  const requestStartTime = Date.now();
  let response: Response;
  
  console.log('[Dify] Starting fetch request...', {
    endpoint,
    timestamp: new Date().toISOString(),
    requestBodySize: JSON.stringify(requestBody).length,
  });
  
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${difyApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
    
    const requestElapsedTime = Date.now() - requestStartTime;
    console.log('[Dify] Fetch request completed:', {
      status: response.status,
      statusText: response.statusText,
      elapsedTime: `${requestElapsedTime}ms`,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      timestamp: new Date().toISOString(),
    });
  } catch (fetchError: unknown) {
    const requestElapsedTime = Date.now() - requestStartTime;
    const errorMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);
    const errorStack = fetchError instanceof Error ? fetchError.stack : undefined;
    console.error('[Dify] Fetch error occurred:', {
      error: errorMessage,
      errorName: fetchError instanceof Error ? fetchError.name : 'Unknown',
      stack: errorStack,
      endpoint,
      elapsedTime: `${requestElapsedTime}ms`,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Failed to call Dify API: ${errorMessage}`);
  }

  console.log('[Dify] Processing response...', {
    status: response.status,
    ok: response.ok,
    timestamp: new Date().toISOString(),
  });
  
  if (!response.ok) {
    console.error('[Dify] Response is not OK, reading error text...');
    const errorText = await response.text();
    console.error('[Dify] API error response:', {
      status: response.status,
      statusText: response.statusText,
      errorText,
      errorTextLength: errorText.length,
      endpoint,
      timestamp: new Date().toISOString(),
    });
    throw new Error(`Dify API error: ${response.status} - ${errorText}`);
  }

  console.log('[Dify] Response is OK, parsing JSON...', {
    timestamp: new Date().toISOString(),
  });
  
  const data = await response.json();
  console.log('[Dify] JSON parsed successfully:', {
    hasAnswer: !!data.answer,
    answerLength: data.answer?.length || 0,
    answerPreview: data.answer?.substring(0, 200) || 'N/A',
    responseKeys: Object.keys(data),
    hasMessageId: !!data.message_id,
    hasConversationId: !!data.conversation_id,
    fullResponse: JSON.stringify(data, null, 2).substring(0, 500),
    timestamp: new Date().toISOString(),
  });
  
  // チャットフローAPIのレスポンスはdata.answerに含まれる
  const answer = data.answer || JSON.stringify(data);
  console.log('[Dify] Returning answer:', {
    length: answer.length,
    preview: answer.substring(0, 200),
    timestamp: new Date().toISOString(),
  });
  return answer;
}

// Dify APIを呼び出す関数（後方互換性のため残す）
async function callDifyWorkflow(userInput: string): Promise<string> {
  const difyApiUrl = process.env.DIFY_API_URL;
  const difyApiKey = process.env.DIFY_API_KEY;
  const workflowId = process.env.DIFY_WORKFLOW_ID;

  // 環境変数のチェック（デバッグ用に詳細なエラーメッセージを出力）
  // workflow_idはオプション。APIキーが特定のアプリケーションに関連付けられている場合は不要
  const missingVars: string[] = [];
  if (!difyApiUrl) missingVars.push('DIFY_API_URL');
  if (!difyApiKey) missingVars.push('DIFY_API_KEY');
  // workflow_idはオプションのため、チェックしない

  if (missingVars.length > 0) {
    const errorMsg = `Dify configuration is missing. Missing environment variables: ${missingVars.join(', ')}`;
    console.error(errorMsg);
    console.error('Environment variables check:', {
      DIFY_API_URL: difyApiUrl ? `${difyApiUrl.substring(0, 20)}...` : 'NOT SET',
      DIFY_API_KEY: difyApiKey ? `${difyApiKey.substring(0, 10)}...` : 'NOT SET',
      DIFY_WORKFLOW_ID: workflowId ? `${workflowId.substring(0, 10)}...` : 'NOT SET (optional)',
    });
    throw new Error(errorMsg);
  }
  
  console.log('Dify configuration check:', {
    DIFY_API_URL: difyApiUrl ? `${difyApiUrl.substring(0, 20)}...` : 'NOT SET',
    DIFY_API_KEY: difyApiKey ? `${difyApiKey.substring(0, 10)}...` : 'NOT SET',
    DIFY_WORKFLOW_ID: workflowId ? `${workflowId.substring(0, 10)}...` : 'NOT SET (will use API key only)',
  });

  // Dify APIのエンドポイント構築
  // ドキュメントによると、チャットアプリAPIは /chat-messages エンドポイントを使用
  // DIFY_API_URLに既にバージョンが含まれている場合（例: https://dify.aibase.buzz/v1）
  // と含まれていない場合（例: https://api.dify.ai）の両方に対応
  let baseUrl = difyApiUrl!.trim();
  
  // 末尾のスラッシュを除去
  if (baseUrl.endsWith('/')) {
    baseUrl = baseUrl.slice(0, -1);
  }
  
  // DIFY_API_URLに既にバージョンが含まれているかチェック
  const hasVersionInUrl = /\/v\d+$/.test(baseUrl);
  
  let endpoint: string;
  if (hasVersionInUrl) {
    // 既にバージョンが含まれている場合（例: https://dify.aibase.buzz/v1）
    endpoint = `${baseUrl}/chat-messages`;
  } else {
    // バージョンが含まれていない場合
    const apiVersion = process.env.DIFY_API_VERSION || 'v1';
    endpoint = `${baseUrl}/${apiVersion}/chat-messages`;
  }

  console.log('Calling Dify API:', {
    endpoint,
    workflowId,
    userInputLength: userInput.length,
  });

  // DifyのチャットアプリAPIのリクエストボディ形式
  // ドキュメントによると、queryはトップレベルに配置し、inputsはオプション
  // workflow_idはオプション。APIキーが特定のアプリケーションに関連付けられている場合は不要
  // チャットフローの場合、APIキーがアプリに関連付けられているため、workflow_idは不要な可能性がある
  const requestBody: {
    query: string;
    inputs: {};
    response_mode: 'blocking';
    user: string;
    workflow_id?: string;
  } = {
    query: userInput,
    inputs: {}, // カスタム入力フィールドがない場合は空オブジェクト
    response_mode: 'blocking',
    user: 'slack-bot',
  };
  
  // workflow_idが指定されている場合のみリクエストボディに含める
  // チャットフローの場合、APIキーがアプリに関連付けられているため、workflow_idを指定するとエラーになる可能性がある
  // そのため、workflow_idは指定しない（APIキーだけでアプリを識別）
  // 注意: 複数のアプリケーションで同じAPIキーを使用する場合は、workflow_idが必要になる可能性がある
  // 現在のエラー（Workflow not found）を回避するため、workflow_idは含めない
  // if (workflowId) {
  //   requestBody.workflow_id = workflowId;
  // }
  
  console.log('Request body structure:', {
    hasQuery: !!requestBody.query,
    hasWorkflowId: !!requestBody.workflow_id,
    inputsKeys: Object.keys(requestBody.inputs),
    workflowIdProvided: !!workflowId,
  });

  console.log('Sending request to Dify API:', {
    endpoint,
    requestBody: JSON.stringify(requestBody),
    timestamp: new Date().toISOString(),
  });

  let response: Response;
  const startTime = Date.now();
  
  // タイムアウト設定（8秒）- Vercelのサーバーレス関数の制限を考慮
  // Vercelの無料プランでは10秒、Proプランでも60秒の制限があるため、余裕を持たせる
  // バックグラウンド処理が完了する前にタイムアウトしないように短めに設定
  const TIMEOUT_MS = 8000;
  const controller = new AbortController();
  let timeoutFired = false;
  const timeoutId = setTimeout(() => {
    timeoutFired = true;
    const elapsedTime = Date.now() - startTime;
    console.error(`Dify API request timeout - aborting after ${TIMEOUT_MS}ms`, {
      elapsedTime: `${elapsedTime}ms`,
      endpoint,
      timestamp: new Date().toISOString(),
    });
    controller.abort();
  }, TIMEOUT_MS);

  try {
    console.log('Starting fetch request to Dify API...', {
      endpoint,
      timestamp: new Date().toISOString(),
      requestBodySize: JSON.stringify(requestBody).length,
      hasApiKey: !!difyApiKey,
      apiKeyPrefix: difyApiKey ? difyApiKey.substring(0, 10) : 'NOT SET',
      timeoutMs: TIMEOUT_MS,
    });
    
    // fetchを実行（AbortControllerでタイムアウト制御）
    const fetchStartTime = Date.now();
    
    // 定期的にログを出力して進行状況を確認
    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - fetchStartTime;
      console.log(`Fetch still in progress... ${elapsed}ms elapsed`, {
        endpoint,
        elapsedMs: elapsed,
      });
    }, 5000); // 5秒ごとにログを出力
    
    let fetchCompleted = false;
    try {
      // fetchを実行（AbortControllerとPromise.raceでタイムアウト制御）
      console.log('Executing fetch...', {
        endpoint,
        method: 'POST',
        hasBody: !!requestBody,
        bodySize: JSON.stringify(requestBody).length,
      });
      
      // fetch Promise
      const fetchPromise = fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${difyApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      // タイムアウト用のPromise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Fetch timeout after ${TIMEOUT_MS}ms`));
        }, TIMEOUT_MS);
      });

      // Promise.raceを使用して、fetchとタイムアウトのどちらかが先に完了するまで待つ
      response = await Promise.race([fetchPromise, timeoutPromise]);
      
      fetchCompleted = true;
      console.log('Fetch promise resolved', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });
    } catch (fetchErr) {
      fetchCompleted = true;
      console.error('Fetch promise rejected', {
        error: fetchErr,
        errorName: fetchErr instanceof Error ? fetchErr.name : 'Unknown',
        errorMessage: fetchErr instanceof Error ? fetchErr.message : 'Unknown error',
      });
      // fetchエラーを再スロー（外側のcatchで処理）
      throw fetchErr;
    } finally {
      clearInterval(progressInterval);
      if (!fetchCompleted) {
        console.error('Fetch did not complete - this should not happen', {
          elapsedTime: `${Date.now() - fetchStartTime}ms`,
        });
      }
    }

    const fetchElapsedTime = Date.now() - fetchStartTime;
    clearTimeout(timeoutId);
    const totalElapsedTime = Date.now() - startTime;
    
    if (timeoutFired) {
      console.error('Timeout was fired but fetch completed anyway', {
        fetchElapsedTime: `${fetchElapsedTime}ms`,
        totalElapsedTime: `${totalElapsedTime}ms`,
      });
    }
    
    console.log(`Fetch completed in ${fetchElapsedTime}ms (total: ${totalElapsedTime}ms)`, {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
    });
  } catch (fetchError) {
    clearTimeout(timeoutId);
    const elapsedTime = Date.now() - startTime;
    
    // エラーの詳細をログに記録
    const errorDetails = {
      error: fetchError,
      errorName: fetchError instanceof Error ? fetchError.name : 'Unknown',
      errorMessage: fetchError instanceof Error ? fetchError.message : 'Unknown error',
      errorStack: fetchError instanceof Error ? fetchError.stack : undefined,
      elapsedTime: `${elapsedTime}ms`,
      endpoint,
      timestamp: new Date().toISOString(),
      timeoutFired,
    };
    
    console.error('Dify API fetch error:', errorDetails);
    
    if (fetchError instanceof Error && (fetchError.name === 'AbortError' || fetchError.message.includes('timeout'))) {
      throw new Error(`Dify API request timeout after ${elapsedTime}ms (${TIMEOUT_MS}ms limit)`);
    }
    
    // ネットワークエラーの場合
    if (fetchError instanceof TypeError) {
      throw new Error(`Network error when calling Dify API: ${fetchError.message}`);
    }
    
    throw new Error(`Failed to call Dify API: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
  }

  console.log('Dify API response received:', {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
  });

  if (!response.ok) {
    let errorText: string;
    let errorData: any;
    try {
      errorText = await response.text();
      try {
        errorData = JSON.parse(errorText);
      } catch {
        // JSONパースに失敗した場合は、テキストのまま使用
        errorData = { message: errorText };
      }
    } catch (err) {
      errorText = 'Failed to read error response';
      errorData = { message: errorText };
    }

    // Dify APIのエラーコードを確認
    const errorCode = errorData?.code || errorData?.error_code;
    const errorMessage = errorData?.message || errorText;

    console.error('Dify API error:', {
      status: response.status,
      statusText: response.statusText,
      endpoint,
      errorCode,
      errorMessage,
      errorText,
      errorData,
    });

    // Dify APIのエラーコードに応じたエラーメッセージを生成
    let userFriendlyError: string;
    if (errorCode === 'not_found' || errorCode === 'workflow_not_found') {
      // エラーメッセージにワークフローIDが含まれているか確認
      if (errorMessage.includes('Workflow not found')) {
        userFriendlyError = `Dify API error: ワークフローが見つかりません (workflow_id: ${workflowId})\n\n` +
          `以下の可能性があります：\n` +
          `• ワークフローIDが正しくない\n` +
          `• ワークフローが公開されていない\n` +
          `• APIキーがそのワークフローにアクセスする権限がない\n` +
          `• ワークフローが削除されている`;
      } else {
        userFriendlyError = `Dify API error: 指定されたワークフローバージョンが見つかりません (workflow_id: ${workflowId})`;
      }
    } else if (errorCode === 'workflow_id_format_error') {
      userFriendlyError = `Dify API error: ワークフローID形式エラー、UUID形式が必要です (workflow_id: ${workflowId})`;
    } else if (errorCode === 'completion_request_error') {
      userFriendlyError = `Dify API error: テキスト生成に失敗しました`;
    } else {
      userFriendlyError = `Dify API error: ${response.status} ${response.statusText} - ${errorMessage}`;
    }

    throw new Error(userFriendlyError);
  }

  const data = await response.json();
  console.log('Dify API response data:', {
    hasAnswer: !!data.answer,
    hasEvent: !!data.event,
    hasMessageId: !!data.message_id,
    hasConversationId: !!data.conversation_id,
    dataKeys: Object.keys(data),
    responsePreview: JSON.stringify(data).substring(0, 300),
  });
  
  // DifyのチャットアプリAPIのレスポンス構造
  // blockingモードの場合、ChatCompletionResponseオブジェクトが返される
  // answerフィールドに完全な応答内容が含まれる
  if (data.answer) {
    console.log('Using data.answer from ChatCompletionResponse');
    return data.answer;
  }
  
  // フォールバック: 予期しないレスポンス構造の場合
  console.warn('Unexpected Dify API response structure:', JSON.stringify(data));
  return JSON.stringify(data, null, 2);
}

// Slackにメッセージを投稿する関数
async function postSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
  userId?: string
): Promise<void> {
  const slackBotToken = process.env.SLACK_BOT_TOKEN;

  if (!slackBotToken) {
    throw new Error('SLACK_BOT_TOKEN is not set');
  }

  // 質問者をメンションする場合、メッセージの先頭にメンションを追加
  let messageText = text;
  if (userId) {
    messageText = `<@${userId}> ${text}`;
  }

  const payload: {
    channel: string;
    text: string;
    thread_ts?: string;
  } = {
    channel,
    text: messageText,
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
    const errorText = await response.text();
    throw new Error(`Slack API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 最初に必ずログを出力（リクエストが到達しているか確認）
  const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  const timestamp = new Date().toISOString();
  
  console.log(`[Events-${requestId}] ====== REQUEST RECEIVED ======`);
  console.log(`[Events-${requestId}] Endpoint: /api/slack/events`);
  console.log(`[Events-${requestId}] Timestamp: ${timestamp}`);
  console.log(`[Events-${requestId}] Method: ${req.method}`);
  console.log(`[Events-${requestId}] URL: ${req.url}`);
  
  // POSTメソッドのみ受け付ける
  if (req.method !== 'POST') {
    console.log(`[Events-${requestId}] Method not allowed: ${req.method}`);
    console.log(`[Events-${requestId}] ====== REQUEST ENDED (405) ======`);
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    console.log(`[Events-${requestId}] Reading request body...`);
    // 生のリクエストボディを読み取る
    const rawBody = await getRawBody(req);
    
    if (!rawBody) {
      console.error(`[Events-${requestId}] Empty request body`);
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (400) ======`);
      return res.status(400).json({ error: 'Empty request body' });
    }

    console.log(`[Events-${requestId}] Raw body received:`, {
      length: rawBody.length,
      preview: rawBody.substring(0, 200),
    });

    // JSONとしてパース
    let body;
    try {
      body = JSON.parse(rawBody);
      console.log(`[Events-${requestId}] Parsed body:`, {
        keys: Object.keys(body),
        type: body.type,
        hasEvent: !!body.event,
      });
    } catch (parseError) {
      console.error(`[Events-${requestId}] Failed to parse JSON:`, parseError);
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (400) ======`);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Slack URL verification (challenge) - 署名検証をスキップ
    if (body.type === 'url_verification') {
      console.log(`[Events-${requestId}] URL verification challenge received`);
      if (!body.challenge) {
        console.error(`[Events-${requestId}] Missing challenge parameter`);
        console.log(`[Events-${requestId}] ====== REQUEST ENDED (400) ======`);
        return res.status(400).json({ error: 'Missing challenge parameter' });
      }
      // challengeの値をそのままプレーンテキストで返す（Slackの仕様）
      console.log(`[Events-${requestId}] Returning challenge: ${body.challenge}`);
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (200 - Challenge) ======`);
      return res.status(200).send(body.challenge);
    }

    // 通常のイベントの場合、署名検証を実行
    const timestampHeader = req.headers['x-slack-request-timestamp'] as string;
    const signature = req.headers['x-slack-signature'] as string;

    if (!timestampHeader || !signature) {
      console.error(`[Events-${requestId}] Missing required headers:`, {
        hasTimestamp: !!timestampHeader,
        hasSignature: !!signature,
      });
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (401) ======`);
      return res.status(401).json({ error: 'Missing required headers' });
    }

    // 署名検証用のbasestringは生のボディを使用
    const basestring = `v0:${timestampHeader}:${rawBody}`;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!signingSecret) {
      console.error(`[Events-${requestId}] SLACK_SIGNING_SECRET is not set`);
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (500) ======`);
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const mySignature = `v0=` + crypto.createHmac('sha256', signingSecret)
    .update(basestring, 'utf8')
    .digest('hex');

    if (mySignature !== signature) {
      console.error(`[Events-${requestId}] Signature verification failed`, {
        expected: signature.substring(0, 20) + '...',
        calculated: mySignature.substring(0, 20) + '...',
      });
      console.log(`[Events-${requestId}] ====== REQUEST ENDED (401) ======`);
      return res.status(401).json({ error: 'Verification failed' });
    }

    console.log(`[Events-${requestId}] Signature verified successfully`);

    // Event handling
    const event = body.event;
    
    console.log(`[Events-${requestId}] Received Slack event:`, {
      type: body.type,
      eventType: event?.type,
      eventSubtype: event?.subtype,
      hasEvent: !!event,
      eventKeys: event ? Object.keys(event) : [],
    });

  // Bot がメンションされた場合の処理
    if (event && event.type === 'app_mention') {
      console.log(`[Events-${requestId}] App mention event detected:`, {
        channel: event.channel,
        user: event.user,
        text: event.text ? event.text.substring(0, 500) : 'N/A',
        ts: event.ts,
        subtype: event.subtype,
      });
      
      // ワークフローメッセージかどうかを確認（「新しい質問が投稿されました!」または「新しい質問が投稿されました！」を含む）
      // 全角と半角の感嘆符の両方に対応
      const isWorkflowMessage = event.text && (
        event.text.includes('新しい質問が投稿されました!') || 
        event.text.includes('新しい質問が投稿されました！')
      );
      
      console.log(`[Events-${requestId}] Workflow message check:`, {
        hasText: !!event.text,
        containsHalfWidth: event.text ? event.text.includes('新しい質問が投稿されました!') : false,
        containsFullWidth: event.text ? event.text.includes('新しい質問が投稿されました！') : false,
        isWorkflowMessage,
        textPreview: event.text ? event.text.substring(0, 100) : 'N/A',
      });
      
      if (isWorkflowMessage) {
        console.log(`[Events-${requestId}] Workflow message detected in app_mention event, processing...`);
        
        // 先に200を返す
        res.status(200).end();
        console.log(`[Events-${requestId}] Response sent, background workflow process will continue`);
        
        // バックグラウンドでワークフローメッセージを処理
        const workflowProcess = (async () => {
          const processStartTime = Date.now();
          console.log(`[Events-${requestId}] Background workflow process started at:`, new Date().toISOString());
          
          try {
            // メッセージからデータを抽出
            let messageText = event.text || '';
            console.log(`[Events-${requestId}] Processing workflow message text, length:`, messageText.length);
            
            // HTMLエスケープされたタグに対応（&lt;と&gt;を<と>に変換）
            messageText = messageText.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            console.log(`[Events-${requestId}] After HTML unescape, length:`, messageText.length);
            
            // ワークフローのメッセージからデータを抽出
            let workflowData: Record<string, string> = {};
            
            // <workflow_data>タグで囲まれたJSONを探す（HTMLエスケープ解除後）
            const jsonMatch = messageText.match(/<workflow_data>([\s\S]*?)<\/workflow_data>/);
            if (jsonMatch) {
              console.log(`[Events-${requestId}] Found workflow_data tag, extracting JSON...`);
              try {
                const jsonText = jsonMatch[1].trim();
                workflowData = JSON.parse(jsonText);
                console.log(`[Events-${requestId}] Extracted workflow data from JSON:`, {
                  keys: Object.keys(workflowData),
                  keyCount: Object.keys(workflowData).length,
                });
                
                // 「への回答」というプレースホルダー値を除外
                const filteredData: Record<string, string> = {};
                for (const [key, value] of Object.entries(workflowData)) {
                  const strValue = String(value);
                  // 「への回答」で終わる値はプレースホルダーなので除外
                  if (!strValue.endsWith('への回答') && strValue.trim() !== '') {
                    filteredData[key] = strValue;
                  }
                }
                workflowData = filteredData;
                console.log(`[Events-${requestId}] Filtered workflow data (removed placeholders):`, {
                  keys: Object.keys(workflowData),
                  keyCount: Object.keys(workflowData).length,
                  data: workflowData,
                });
              } catch (parseError) {
                console.error(`[Events-${requestId}] Failed to parse JSON data:`, {
                  error: parseError instanceof Error ? parseError.message : String(parseError),
                  jsonText: jsonMatch[1].substring(0, 500),
                });
              }
            } else {
              console.log(`[Events-${requestId}] No workflow_data tag found, trying text extraction...`);
              // 方法2: メッセージテキストから各フィールドを抽出
              const fields = [
                '概要', '当選者', '応募者情報抽出', '応募者選定情報',
                '個人情報管理', '問い合わせ内容', 'DM送付', '発送対応',
                'オプション', '商品カテゴリ', '商品'
              ];
              
              fields.forEach(field => {
                // フィールド名の後に値が続くパターンを探す
                const regex = new RegExp(`${field}[：:]([^\\n]+)`, 'g');
                const match = messageText.match(regex);
                if (match && match[0]) {
                  const value = match[0].replace(new RegExp(`${field}[：:]`), '').trim();
                  // 「への回答」で終わる値は除外
                  if (value && !value.endsWith('への回答')) {
                    workflowData[field] = value;
                  }
                }
              });
              
              console.log(`[Events-${requestId}] Extracted workflow data from text:`, {
                keys: Object.keys(workflowData),
                keyCount: Object.keys(workflowData).length,
              });
            }
            
            // Dify APIを呼び出す（callDifyChatFlowを使用）
            if (Object.keys(workflowData).length > 0) {
              console.log(`[Events-${requestId}] Calling Dify Chat Flow API with ${Object.keys(workflowData).length} inputs...`);
              const difyResponse = await callDifyChatFlow(workflowData);
              console.log(`[Events-${requestId}] Dify API response received:`, {
                responseLength: difyResponse.length,
                preview: difyResponse.substring(0, 100),
              });
              
              // Slackに結果を投稿（ワークフローメッセージのスレッドに返信）
              console.log(`[Events-${requestId}] Posting to Slack channel:`, {
                channel: event.channel,
                threadTs: event.ts,
                messageTs: event.ts,
              });
              await postSlackMessage(
                event.channel,
                `📋 *肥田さんへの質問の回答*\n\n${difyResponse}`,
                event.ts // ワークフローメッセージのtsをthreadTsとして使用してスレッド返信
              );
              
              const elapsedTime = Date.now() - processStartTime;
              console.log(`[Events-${requestId}] Workflow processed successfully`, {
                elapsedTime: `${elapsedTime}ms`,
              });
            } else {
              console.warn(`[Events-${requestId}] No workflow data extracted, skipping Dify API call`);
            }
          } catch (error) {
            const elapsedTime = Date.now() - processStartTime;
            console.error(`[Events-${requestId}] Error processing workflow message:`, {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              elapsedTime: `${elapsedTime}ms`,
            });
            
            // エラーをSlackに通知
            try {
              await postSlackMessage(
                event.channel,
                `❌ エラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
                event.ts
              );
            } catch (slackError) {
              console.error(`[Events-${requestId}] Failed to post error to Slack:`, slackError);
            }
          }
        })();
        
        console.log(`[Events-${requestId}] Calling waitUntil for workflow process...`);
        waitUntil(workflowProcess);
        console.log(`[Events-${requestId}] waitUntil called, handler will return`);
        console.log(`[Events-${requestId}] ====== HANDLER RETURNING ======`);
        return;
      }
      
      // Bot自身のメッセージは無視（ワークフローメッセージ以外）
      if (event.subtype === 'bot_message') {
        console.log(`[Events-${requestId}] Ignoring bot's own message (not a workflow message)`);
        console.log(`[Events-${requestId}] ====== REQUEST ENDED (200) ======`);
        return res.status(200).end();
      }

      // SlackのイベントAPIは3秒以内に応答する必要があるため、
      // 先に200を返してからバックグラウンドで処理を実行
      res.status(200).end();
      
      console.log(`[Events-${requestId}] Sent 200 response, starting background processing`);

      // バックグラウンドでDify APIを呼び出し、結果をSlackに投稿
      // waitUntil()を使用して、Vercelの実行時間制限内でバックグラウンド処理を実行
      const backgroundProcess = (async () => {
        const processStartTime = Date.now();
        try {
          console.log(`[Events-${requestId}] Background processing started`, {
            timestamp: new Date().toISOString(),
            channel: event.channel,
            ts: event.ts,
          });
          
          // メンション部分を除去してメッセージテキストを取得
          const messageText = event.text
            .replace(/<@[A-Z0-9]+>/g, '') // メンションを除去
            .trim();

          if (!messageText) {
            console.log(`[Events-${requestId}] Message text is empty`);
            await postSlackMessage(
              event.channel,
              'メッセージが空です。質問を入力してください。',
              event.ts,
              event.user
            );
            return;
          }

          console.log(`[Events-${requestId}] Processing app mention:`, {
            channel: event.channel,
            user: event.user,
            textLength: messageText.length,
            textPreview: messageText.substring(0, 100),
          });

          // Dify APIを呼び出し
          console.log(`[Events-${requestId}] About to call Dify API with message:`, messageText.substring(0, 100));
          const difyResponse = await callDifyWorkflow(messageText);
          console.log(`[Events-${requestId}] Dify API call completed, response length:`, difyResponse.length);

          // Slackに結果を投稿（スレッドで返信、質問者をメンション）
          console.log(`[Events-${requestId}] Posting to Slack channel:`, event.channel);
          await postSlackMessage(
            event.channel,
            difyResponse,
            event.ts,
            event.user
          );

          const processElapsedTime = Date.now() - processStartTime;
          console.log(`[Events-${requestId}] Successfully processed app mention`, {
            elapsedTime: `${processElapsedTime}ms`,
          });
        } catch (error) {
          const processElapsedTime = Date.now() - processStartTime;
          console.error(`[Events-${requestId}] Error processing app mention:`, {
            error: error instanceof Error ? error.message : String(error),
            errorName: error instanceof Error ? error.name : 'Unknown',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorStack: error instanceof Error ? error.stack : undefined,
            channel: event.channel,
            ts: event.ts,
            elapsedTime: `${processElapsedTime}ms`,
            timestamp: new Date().toISOString(),
          });
          
          // エラーをSlackに通知（必ず実行されるようにする）
          let errorMessage = 'エラーが発生しました。';
          
          if (error instanceof Error) {
            // 環境変数が不足している場合のメッセージ
            if (error.message.includes('Dify configuration is missing')) {
              errorMessage = `❌ Difyの設定が不足しています。\n\n` +
                `Vercelの環境変数に以下が設定されているか確認してください：\n` +
                `• DIFY_API_URL\n` +
                `• DIFY_API_KEY\n` +
                `• DIFY_WORKFLOW_ID\n\n` +
                `詳細はVercelのログを確認してください。`;
            } else if (error.message.includes('Dify API error')) {
              errorMessage = `❌ Dify APIでエラーが発生しました。\n\n` +
                `${error.message}\n\n` +
                `Vercelのログで詳細を確認してください。`;
            } else if (error.message.includes('timeout')) {
              errorMessage = `❌ Dify APIへのリクエストがタイムアウトしました。\n\n` +
                `${error.message}\n\n` +
                `Difyのワークフローが長時間実行されている可能性があります。\n` +
                `Vercelのログで詳細を確認してください。`;
            } else if (error.message.includes('Network error')) {
              errorMessage = `❌ Dify APIへのネットワークエラーが発生しました。\n\n` +
                `${error.message}\n\n` +
                `ネットワーク接続を確認してください。\n` +
                `Vercelのログで詳細を確認してください。`;
            } else {
              errorMessage = `❌ エラーが発生しました。\n\n` +
                `${error.message}\n\n` +
                `Vercelのログで詳細を確認してください。`;
            }
          } else {
            errorMessage += ' Unknown error';
          }
          
          // Slackへのエラーメッセージ送信を試みる（失敗してもログに記録、質問者をメンション）
          try {
            console.log(`[Events-${requestId}] Posting error message to Slack...`);
            await postSlackMessage(
              event.channel,
              errorMessage,
              event.ts,
              event.user
            );
            console.log(`[Events-${requestId}] Error message sent to Slack successfully`);
          } catch (slackError) {
            console.error(`[Events-${requestId}] Failed to post error message to Slack:`, {
              error: slackError instanceof Error ? slackError.message : String(slackError),
              errorName: slackError instanceof Error ? slackError.name : 'Unknown',
              errorMessage: slackError instanceof Error ? slackError.message : 'Unknown error',
              errorStack: slackError instanceof Error ? slackError.stack : undefined,
              channel: event.channel,
              ts: event.ts,
            });
          }
        }
      })();

      // waitUntil()を使用して、Vercelの実行時間制限内でバックグラウンド処理を実行
      console.log(`[Events-${requestId}] Calling waitUntil for background process...`);
      waitUntil(backgroundProcess);
      console.log(`[Events-${requestId}] waitUntil called, handler will return`);
      console.log(`[Events-${requestId}] ====== HANDLER RETURNING ======`);

      // バックグラウンド処理を開始したので、ここでreturn
      return;
    }

    // ワークフローからのメッセージを処理
    // すべてのメッセージイベントをログに記録（デバッグ用）
    if (event && event.type === 'message') {
      console.log(`[Events-${requestId}] ====== MESSAGE EVENT DETECTED ======`);
      console.log(`[Events-${requestId}] Message event details:`, {
        channel: event.channel,
        text: event.text ? event.text.substring(0, 500) : 'N/A',
        textLength: event.text ? event.text.length : 0,
        ts: event.ts,
        bot_id: event.bot_id,
        subtype: event.subtype,
        hasText: !!event.text,
        eventKeys: Object.keys(event),
        fullEvent: JSON.stringify(event, null, 2).substring(0, 1000),
      });

      // ワークフローメッセージかどうかを確認（「新しい質問が投稿されました!」または「新しい質問が投稿されました！」を含む）
      // 全角と半角の感嘆符の両方に対応
      const isWorkflowMessage = event.text && (
        event.text.includes('新しい質問が投稿されました!') || 
        event.text.includes('新しい質問が投稿されました！')
      );
      
      console.log(`[Events-${requestId}] Message event analysis:`, {
        isWorkflowMessage,
        subtype: event.subtype,
        hasWorkflowText: isWorkflowMessage,
        containsHalfWidth: event.text ? event.text.includes('新しい質問が投稿されました!') : false,
        containsFullWidth: event.text ? event.text.includes('新しい質問が投稿されました！') : false,
      });

      // ワークフローのメッセージかどうかを確認（「新しい質問が投稿されました!」を含む）
      // subtypeに関係なく、テキストに「新しい質問が投稿されました!」が含まれていれば処理
      if (isWorkflowMessage) {
        console.log(`[Events-${requestId}] Workflow message detected, processing...`);
        
        // 先に200を返す
        res.status(200).end();
        console.log(`[Events-${requestId}] Response sent, background process will continue`);
        
        // バックグラウンドで処理
        const workflowProcess = (async () => {
          const processStartTime = Date.now();
          console.log(`[Events-${requestId}] Background workflow process started at:`, new Date().toISOString());
          
          try {
            // メッセージからデータを抽出
            let messageText = event.text || '';
            console.log(`[Events-${requestId}] Processing message text, length:`, messageText.length);
            
            // HTMLエスケープされたタグに対応（&lt;と&gt;を<と>に変換）
            messageText = messageText.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            console.log(`[Events-${requestId}] After HTML unescape, length:`, messageText.length);
            
            // ワークフローのメッセージからデータを抽出
            let workflowData: Record<string, string> = {};
            
            // <workflow_data>タグで囲まれたJSONを探す（HTMLエスケープ解除後）
            const jsonMatch = messageText.match(/<workflow_data>([\s\S]*?)<\/workflow_data>/);
            if (jsonMatch) {
              console.log(`[Events-${requestId}] Found workflow_data tag, extracting JSON...`);
              try {
                const jsonText = jsonMatch[1].trim();
                workflowData = JSON.parse(jsonText);
                console.log(`[Events-${requestId}] Extracted workflow data from JSON:`, {
                  keys: Object.keys(workflowData),
                  keyCount: Object.keys(workflowData).length,
                });
                
                // 「への回答」というプレースホルダー値を除外
                const filteredData: Record<string, string> = {};
                for (const [key, value] of Object.entries(workflowData)) {
                  const strValue = String(value);
                  // 「への回答」で終わる値はプレースホルダーなので除外
                  if (!strValue.endsWith('への回答') && strValue.trim() !== '') {
                    filteredData[key] = strValue;
                  }
                }
                workflowData = filteredData;
                console.log(`[Events-${requestId}] Filtered workflow data (removed placeholders):`, {
                  keys: Object.keys(workflowData),
                  keyCount: Object.keys(workflowData).length,
                });
              } catch (parseError) {
                console.error(`[Events-${requestId}] Failed to parse JSON data:`, {
                  error: parseError instanceof Error ? parseError.message : String(parseError),
                  jsonText: jsonMatch[1].substring(0, 200),
                });
              }
            } else {
              console.log(`[Events-${requestId}] No workflow_data tag found, trying text extraction...`);
              // 方法2: メッセージテキストから各フィールドを抽出
              const fields = [
                '概要', '当選者', '応募者情報抽出', '応募者選定情報',
                '個人情報管理', '問い合わせ内容', 'DM送付', '発送対応',
                'オプション', '商品カテゴリ', '商品'
              ];
              
              fields.forEach(field => {
                // フィールド名の後に値が続くパターンを探す
                const regex = new RegExp(`${field}[：:]([^\\n]+)`, 'g');
                const match = messageText.match(regex);
                if (match && match[0]) {
                  const value = match[0].replace(new RegExp(`${field}[：:]`), '').trim();
                  // 「への回答」で終わる値は除外
                  if (value && !value.endsWith('への回答')) {
                    workflowData[field] = value;
                  }
                }
              });
              
              console.log(`[Events-${requestId}] Extracted workflow data from text:`, {
                keys: Object.keys(workflowData),
                keyCount: Object.keys(workflowData).length,
              });
            }
            
            // Dify APIを呼び出す（callDifyChatFlowを使用）
            if (Object.keys(workflowData).length > 0) {
              console.log(`[Events-${requestId}] Calling Dify Chat Flow API with ${Object.keys(workflowData).length} inputs...`);
              const difyResponse = await callDifyChatFlow(workflowData);
              console.log(`[Events-${requestId}] Dify API response received:`, {
                responseLength: difyResponse.length,
                preview: difyResponse.substring(0, 100),
              });
              
              // Slackに結果を投稿（ワークフローメッセージのスレッドに返信）
              console.log(`[Events-${requestId}] Posting to Slack channel:`, {
                channel: event.channel,
                threadTs: event.ts,
                messageTs: event.ts,
              });
              await postSlackMessage(
                event.channel,
                `📋 *肥田さんへの質問の回答*\n\n${difyResponse}`,
                event.ts // ワークフローメッセージのtsをthreadTsとして使用してスレッド返信
              );
              
              const elapsedTime = Date.now() - processStartTime;
              console.log(`[Events-${requestId}] Workflow processed successfully`, {
                elapsedTime: `${elapsedTime}ms`,
              });
            } else {
              console.warn(`[Events-${requestId}] No workflow data extracted, skipping Dify API call`);
            }
          } catch (error) {
            const elapsedTime = Date.now() - processStartTime;
            console.error(`[Events-${requestId}] Error processing workflow message:`, {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              elapsedTime: `${elapsedTime}ms`,
            });
            
            // エラーをSlackに通知
            try {
              await postSlackMessage(
                event.channel,
                `❌ エラーが発生しました: ${error instanceof Error ? error.message : 'Unknown error'}`,
                event.ts
              );
            } catch (slackError) {
              console.error(`[Events-${requestId}] Failed to post error to Slack:`, slackError);
            }
          }
        })();
        
        console.log(`[Events-${requestId}] Calling waitUntil for workflow process...`);
        waitUntil(workflowProcess);
        console.log(`[Events-${requestId}] waitUntil called, handler will return`);
        console.log(`[Events-${requestId}] ====== HANDLER RETURNING ======`);
        return;
      } else {
        console.log(`[Events-${requestId}] Message detected but not a workflow message:`, {
          hasText: !!event.text,
          textPreview: event.text ? event.text.substring(0, 200) : 'N/A',
          containsWorkflowText: event.text ? event.text.includes('新しい質問が投稿されました!') : false,
          subtype: event.subtype,
          bot_id: event.bot_id,
        });
        console.log(`[Events-${requestId}] ====== MESSAGE EVENT IGNORED (Not workflow message) ======`);
      }
    } else if (event && event.type !== 'message') {
      console.log(`[Events-${requestId}] Non-message event type:`, {
        eventType: event.type,
        eventSubtype: event.subtype,
        eventKeys: Object.keys(event),
      });
    }

    // その他のイベントタイプは正常に受け取ったことを返す
    console.log(`[Events-${requestId}] Other event type, returning 200`);
    console.log(`[Events-${requestId}] ====== REQUEST ENDED (200) ======`);
    res.status(200).end();
  } catch (error) {
    console.error(`[Events-${requestId}] ====== TOP LEVEL ERROR ======`);
    console.error(`[Events-${requestId}] Error processing Slack event:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    console.log(`[Events-${requestId}] ====== REQUEST ENDED (500) ======`);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
