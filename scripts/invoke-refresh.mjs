// Invoke the refresher on demand. The schedule handles the steady state; this is for
// "I just deployed, prove it works".
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const fn = process.env.REFRESH_FUNCTION ?? 'iphone-hunter-refresh';
const payload = process.argv[2] ? { only: process.argv[2] } : {};

const c = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
const t = Date.now();
const res = await c.send(new InvokeCommand({
  FunctionName: fn,
  Payload: Buffer.from(JSON.stringify(payload)),
  LogType: 'Tail',
}));

const body = res.Payload ? JSON.parse(Buffer.from(res.Payload).toString()) : null;
console.log('status :', res.StatusCode, res.FunctionError ? `ERROR ${res.FunctionError}` : 'ok');
console.log('result :', JSON.stringify(body));
console.log('elapsed:', ((Date.now() - t) / 1000).toFixed(1) + 's');
if (res.LogResult) {
  const log = Buffer.from(res.LogResult, 'base64').toString();
  console.log('--- tail ---');
  console.log(log.split('\n').slice(-12).join('\n'));
}
