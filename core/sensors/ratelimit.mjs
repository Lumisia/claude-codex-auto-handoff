const TOLERANCE_PCT = 5; // shadow 비교 허용 오차(샘플 시점 차이 흡수)

const safe = async (fn) => { try { return await fn(); } catch { return null; } };

export async function readRateLimit({ readApp, readJsonl, shadow = false, onMismatch } = {}) {
  const app = await safe(readApp);

  if (shadow) {
    const js = await safe(readJsonl);
    if (app && js && Math.abs(app.usedPercent - js.usedPercent) > TOLERANCE_PCT) {
      if (onMismatch) onMismatch(app, js);
    }
    if (app) return app;
    if (js) return js;
    return { source: 'unknown' };
  }

  if (app) return app;
  const js = await safe(readJsonl);
  if (js) return js;
  return { source: 'unknown' };
}
