/**
 * Feedback View — Message feedback analytics with thumbs up/down statistics.
 *
 * Displays feedback summary, session breakdown, and recent feedback items.
 * API: /api/feedback (GET)
 */

let sessionFilter = '';

export async function render(container) {
  container.innerHTML = '<div class="db-loading"><div class="db-spinner"></div></div>';

  let feedbackData = {};
  try { 
    const url = sessionFilter ? `/api/feedback?session_id=${sessionFilter}` : '/api/feedback';
    const r = await fetch(url); 
    feedbackData = await r.json(); 
  } catch(e) {
    console.error('Failed to fetch feedback:', e);
  }

  const { feedback = [], summary = {} } = feedbackData;
  const { total = 0, positive = 0, negative = 0, neutral = 0, by_session = {} } = summary;

  // Calculate percentages
  const positiveRate = total > 0 ? Math.round((positive / total) * 100) : 0;
  const negativeRate = total > 0 ? Math.round((negative / total) * 100) : 0;
  const neutralRate = total > 0 ? Math.round((neutral / total) * 100) : 0;

  // Session names for filter
  const sessionNames = Object.keys(by_session);

  container.innerHTML = `
    <!-- Controls Bar -->
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
      <h2 style="margin:0;color:var(--db-text);font-size:20px;font-weight:600">Feedback Analytics</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="feedback-filter-session" style="padding:5px 10px;background:var(--db-card-bg);border:1px solid var(--db-border);border-radius:6px;color:var(--db-text);font-size:12px">
          <option value="">All Sessions</option>
          ${sessionNames.map(s => `<option value="${s}"${sessionFilter===s?' selected':''}>${s.slice(0, 8)}...</option>`).join('')}
        </select>
        <button onclick="refreshFeedback()" style="padding:5px 12px;background:var(--db-accent);border:none;color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:500">Refresh</button>
      </div>
    </div>

    <!-- Summary Cards -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
      <div style="background:var(--db-card-bg);padding:20px;border-radius:12px;border:1px solid var(--db-border)">
        <div style="color:var(--db-text-muted);font-size:12px;font-weight:500;margin-bottom:8px">Total Feedback</div>
        <div style="font-size:28px;font-weight:700;color:var(--db-text)">${total.toLocaleString()}</div>
      </div>
      <div style="background:var(--db-card-bg);padding:20px;border-radius:12px;border:1px solid var(--db-border)">
        <div style="color:var(--db-text-muted);font-size:12px;font-weight:500;margin-bottom:8px">👍 Positive</div>
        <div style="font-size:28px;font-weight:700;color:#22c55e">${positive}</div>
        <div style="color:var(--db-text-muted);font-size:11px">${positiveRate}% of total</div>
      </div>
      <div style="background:var(--db-card-bg);padding:20px;border-radius:12px;border:1px solid var(--db-border)">
        <div style="color:var(--db-text-muted);font-size:12px;font-weight:500;margin-bottom:8px">👎 Negative</div>
        <div style="font-size:28px;font-weight:700;color:#ef4444">${negative}</div>
        <div style="color:var(--db-text-muted);font-size:11px">${negativeRate}% of total</div>
      </div>
      <div style="background:var(--db-card-bg);padding:20px;border-radius:12px;border:1px solid var(--db-border)">
        <div style="color:var(--db-text-muted);font-size:12px;font-weight:500;margin-bottom:8px">😐 Neutral</div>
        <div style="font-size:28px;font-weight:700;color:var(--db-text-muted)">${neutral}</div>
        <div style="color:var(--db-text-muted);font-size:11px">${neutralRate}% of total</div>
      </div>
    </div>

    <!-- Session Breakdown -->
    ${sessionNames.length > 0 ? `
    <div style="background:var(--db-card-bg);border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid var(--db-border)">
      <h3 style="margin:0 0 16px 0;color:var(--db-text);font-size:16px;font-weight:600">By Session</h3>
      <div style="max-height:300px;overflow-y:auto">
        ${sessionNames.map(sessionId => {
          const sess = by_session[sessionId];
          const sessTotal = sess.total;
          const posRate = sessTotal > 0 ? Math.round((sess.positive / sessTotal) * 100) : 0;
          const negRate = sessTotal > 0 ? Math.round((sess.negative / sessTotal) * 100) : 0;
          
          return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--db-border-light)">
            <div>
              <div style="font-family:monospace;font-size:12px;color:var(--db-text)">${sessionId.slice(0, 16)}...</div>
              <div style="font-size:11px;color:var(--db-text-muted)">${sessTotal} feedback${sessTotal === 1 ? '' : 's'}</div>
            </div>
            <div style="display:flex;gap:8px;font-size:12px">
              <span style="color:#22c55e">👍 ${sess.positive} (${posRate}%)</span>
              <span style="color:#ef4444">👎 ${sess.negative} (${negRate}%)</span>
            </div>
          </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}

    <!-- Recent Feedback -->
    <div style="background:var(--db-card-bg);border-radius:12px;padding:20px;border:1px solid var(--db-border)">
      <h3 style="margin:0 0 16px 0;color:var(--db-text);font-size:16px;font-weight:600">Recent Feedback</h3>
      ${feedback.length === 0 ? `
        <div style="text-align:center;padding:40px;color:var(--db-text-muted)">
          <div style="font-size:48px;margin-bottom:12px">👍</div>
          <div style="font-size:16px;margin-bottom:8px">No feedback yet</div>
          <div style="font-size:12px">Feedback will appear here when users rate messages</div>
        </div>
      ` : `
        <div style="max-height:400px;overflow-y:auto">
          ${feedback.slice(0, 20).map(item => {
            const value = item.value || 0;
            const emoji = value > 0 ? '👍' : value < 0 ? '👎' : '😐';
            const color = value > 0 ? '#22c55e' : value < 0 ? '#ef4444' : 'var(--db-text-muted)';
            const date = item.created_at ? new Date(item.created_at).toLocaleString() : 'Unknown';
            
            return `
            <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--db-border-light)">
              <div style="font-size:18px">${emoji}</div>
              <div style="flex:1">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-family:monospace;font-size:11px;color:var(--db-text-muted)">
                    ${item.session_id?.slice(0, 12)}...
                  </span>
                  <span style="font-size:11px;color:var(--db-text-muted)">${date}</span>
                </div>
                ${item.comment ? `
                  <div style="background:var(--db-bg);padding:8px;border-radius:6px;font-size:12px;color:var(--db-text);border-left:3px solid ${color}">
                    "${item.comment}"
                  </div>
                ` : `
                  <div style="font-size:12px;color:var(--db-text-muted);font-style:italic">
                    No comment provided
                  </div>
                `}
              </div>
            </div>
            `;
          }).join('')}
        </div>
      `}
    </div>
  `;

  // Add event listeners
  const sessionSelect = document.getElementById('feedback-filter-session');
  if (sessionSelect) {
    sessionSelect.addEventListener('change', (e) => {
      sessionFilter = e.target.value;
      render(container);
    });
  }
}

// Global refresh function
window.refreshFeedback = () => {
  const container = document.querySelector('[data-view="feedback"]');
  if (container) render(container);
};