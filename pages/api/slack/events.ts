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

// Dify APIを呼び出す関数
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
  // POSTメソッドのみ受け付ける
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 生のリクエストボディを読み取る
    const rawBody = await getRawBody(req);
    
    if (!rawBody) {
      return res.status(400).json({ error: 'Empty request body' });
    }

    // JSONとしてパース
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('Failed to parse JSON:', parseError);
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Slack URL verification (challenge) - 署名検証をスキップ
    if (body.type === 'url_verification') {
      if (!body.challenge) {
        return res.status(400).json({ error: 'Missing challenge parameter' });
      }
      // challengeの値をそのままプレーンテキストで返す（Slackの仕様）
      return res.status(200).send(body.challenge);
    }

    // 通常のイベントの場合、署名検証を実行
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signature = req.headers['x-slack-signature'] as string;

    if (!timestamp || !signature) {
      return res.status(401).json({ error: 'Missing required headers' });
    }

    // 署名検証用のbasestringは生のボディを使用
    const basestring = `v0:${timestamp}:${rawBody}`;
    const signingSecret = process.env.SLACK_SIGNING_SECRET;

    if (!signingSecret) {
      console.error('SLACK_SIGNING_SECRET is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const mySignature = `v0=` + crypto.createHmac('sha256', signingSecret)
    .update(basestring, 'utf8')
    .digest('hex');

  if (mySignature !== signature) {
      console.error('Signature verification failed', {
        expected: signature,
        calculated: mySignature,
      });
      return res.status(401).json({ error: 'Verification failed' });
  }

  // Event handling
    const event = body.event;
    
    console.log('Received Slack event:', {
      type: body.type,
      eventType: event?.type,
      eventSubtype: event?.subtype,
      hasEvent: !!event,
    });

  // Bot がメンションされた場合の処理
    if (event && event.type === 'app_mention') {
      console.log('App mention event detected:', {
        channel: event.channel,
        user: event.user,
        text: event.text,
        ts: event.ts,
      });
      // Bot自身のメッセージは無視
      if (event.subtype === 'bot_message') {
        return res.status(200).end();
      }

      // SlackのイベントAPIは3秒以内に応答する必要があるため、
      // 先に200を返してからバックグラウンドで処理を実行
      res.status(200).end();
      
      console.log('Sent 200 response, starting background processing');

      // バックグラウンドでDify APIを呼び出し、結果をSlackに投稿
      // waitUntil()を使用して、Vercelの実行時間制限内でバックグラウンド処理を実行
      const backgroundProcess = (async () => {
        const processStartTime = Date.now();
        try {
          console.log('Background processing started', {
            timestamp: new Date().toISOString(),
            channel: event.channel,
            ts: event.ts,
          });
          
          // メンション部分を除去してメッセージテキストを取得
          const messageText = event.text
            .replace(/<@[A-Z0-9]+>/g, '') // メンションを除去
            .trim();

          if (!messageText) {
            await postSlackMessage(
              event.channel,
              'メッセージが空です。質問を入力してください。',
              event.ts,
              event.user
            );
            return;
          }

          console.log('Processing app mention:', {
            channel: event.channel,
            user: event.user,
            text: messageText,
          });

          // Dify APIを呼び出し
          console.log('About to call Dify API with message:', messageText.substring(0, 100));
          const difyResponse = await callDifyWorkflow(messageText);
          console.log('Dify API call completed, response length:', difyResponse.length);

          // Slackに結果を投稿（スレッドで返信、質問者をメンション）
          await postSlackMessage(
            event.channel,
            difyResponse,
            event.ts,
            event.user
          );

          const processElapsedTime = Date.now() - processStartTime;
          console.log('Successfully processed app mention', {
            elapsedTime: `${processElapsedTime}ms`,
          });
        } catch (error) {
          const processElapsedTime = Date.now() - processStartTime;
          console.error('Error processing app mention:', {
            error,
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
            await postSlackMessage(
              event.channel,
              errorMessage,
              event.ts,
              event.user
            );
            console.log('Error message sent to Slack successfully');
          } catch (slackError) {
            console.error('Failed to post error message to Slack:', {
              slackError,
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
      // Next.jsのAPI Routesでは、waitUntil()はresオブジェクトから取得する必要がある可能性があるが、
      // @vercel/functionsから直接インポートしたwaitUntil()を使用
      waitUntil(backgroundProcess);

      // バックグラウンド処理を開始したので、ここでreturn
      return;
    }

    // その他のイベントタイプは正常に受け取ったことを返す
    res.status(200).end();
  } catch (error) {
    console.error('Error processing Slack event:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
