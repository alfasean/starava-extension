// TEMPORARY: content-script transport for the probe (only in VITE_PROBE builds).
import { probeFetch } from './probe';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'probe-fetch') return false;
  probeFetch(msg.url).then(sendResponse);
  return true;
});
