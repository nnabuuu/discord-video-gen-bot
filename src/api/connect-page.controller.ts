import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';

@Controller('connect')
export class ConnectPageController {
  @Get()
  getConnectPage(@Query('code') code: string, @Res() res: Response) {
    if (!code) {
      res.status(400).send(this.renderError('Connection code is required. Please use /api-key connect in Discord.'));
      return;
    }

    res.type('text/html').send(this.renderPage(code));
  }

  private renderError(message: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - API Key Connection</title>
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="error-icon">⚠️</div>
      <h1>Error</h1>
      <p class="error-message">${message}</p>
    </div>
  </div>
</body>
</html>`;
  }

  private renderPage(code: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect API Key - Discord Bot</title>
  <style>${this.getStyles()}</style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">🍌</div>
      <h1>Connect Your Gemini API Key</h1>

      <div id="loading" class="loading">
        <div class="spinner"></div>
        <p>Loading...</p>
      </div>

      <div id="content" style="display: none;">
        <div id="status-section" class="section">
          <h2>Current Status</h2>
          <div id="status-info"></div>
        </div>

        <div id="connect-section" class="section">
          <h2>Connect New API Key</h2>
          <p class="hint">Get your API key from <a href="https://aistudio.google.com/apikey" target="_blank">Google AI Studio</a></p>
          <form id="connect-form">
            <input type="password" id="api-key" placeholder="Enter your Gemini API key" required>
            <button type="submit" id="submit-btn">Connect API Key</button>
          </form>
        </div>

        <div id="disconnect-section" class="section" style="display: none;">
          <button id="disconnect-btn" class="btn-danger">Disconnect API Key</button>
        </div>
      </div>

      <div id="error" class="error-message" style="display: none;"></div>
      <div id="success" class="success-message" style="display: none;"></div>

      <div class="footer">
        <p>This page expires in <span id="expires">10 minutes</span>.</p>
        <p>Return to Discord after connecting your key.</p>
      </div>
    </div>
  </div>

  <script>
    const code = '${code}';
    const apiBase = '/api/connect';
    let hasKey = false;

    async function loadStatus() {
      try {
        const res = await fetch(apiBase + '?code=' + encodeURIComponent(code));

        if (!res.ok) {
          const error = await res.json().catch(() => ({ message: 'Connection code invalid or expired' }));
          throw new Error(error.message || 'Failed to load status');
        }

        const status = await res.json();
        hasKey = status.hasKey;
        renderStatus(status);
        document.getElementById('loading').style.display = 'none';
        document.getElementById('content').style.display = 'block';
      } catch (error) {
        document.getElementById('loading').style.display = 'none';
        showError(error.message || 'Failed to load status. The code may have expired.');
      }
    }

    function renderStatus(status) {
      const statusInfo = document.getElementById('status-info');
      const disconnectSection = document.getElementById('disconnect-section');

      if (status.hasKey) {
        statusInfo.innerHTML = '<div class="status-connected"><span class="status-dot connected"></span>Connected: <code>' + status.maskedKey + '</code></div>';
        if (status.connectedAt) {
          statusInfo.innerHTML += '<p class="connected-at">Connected ' + new Date(status.connectedAt).toLocaleString() + '</p>';
        }
        disconnectSection.style.display = 'block';
        document.querySelector('#connect-section h2').textContent = 'Replace API Key';
      } else {
        statusInfo.innerHTML = '<div class="status-disconnected"><span class="status-dot disconnected"></span>No API key connected</div>';
        disconnectSection.style.display = 'none';
        document.querySelector('#connect-section h2').textContent = 'Connect API Key';
      }
    }

    document.getElementById('connect-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const apiKey = document.getElementById('api-key').value.trim();
      const submitBtn = document.getElementById('submit-btn');

      if (!apiKey) return;

      submitBtn.disabled = true;
      submitBtn.textContent = 'Connecting...';
      hideMessages();

      try {
        const res = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, apiKey })
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.message || 'Failed to connect API key');
        }

        showSuccess('API key connected successfully! You can now close this page and return to Discord.');
        document.getElementById('api-key').value = '';
        loadStatus();
      } catch (error) {
        showError(error.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect API Key';
      }
    });

    document.getElementById('disconnect-btn').addEventListener('click', async () => {
      if (!confirm('Are you sure you want to disconnect your API key?')) return;

      const btn = document.getElementById('disconnect-btn');
      btn.disabled = true;
      btn.textContent = 'Disconnecting...';
      hideMessages();

      try {
        const res = await fetch(apiBase + '?code=' + encodeURIComponent(code), {
          method: 'DELETE'
        });

        const result = await res.json();

        if (!res.ok) {
          throw new Error(result.message || 'Failed to disconnect');
        }

        showSuccess('API key disconnected successfully.');
        loadStatus();
      } catch (error) {
        showError(error.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Disconnect API Key';
      }
    });

    function showError(message) {
      const el = document.getElementById('error');
      el.textContent = message;
      el.style.display = 'block';
      document.getElementById('success').style.display = 'none';
    }

    function showSuccess(message) {
      const el = document.getElementById('success');
      el.textContent = message;
      el.style.display = 'block';
      document.getElementById('error').style.display = 'none';
    }

    function hideMessages() {
      document.getElementById('error').style.display = 'none';
      document.getElementById('success').style.display = 'none';
    }

    // Load status on page load
    loadStatus();
  </script>
</body>
</html>`;
  }

  private getStyles(): string {
    return `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      color: #e0e0e0;
    }

    .container {
      width: 100%;
      max-width: 480px;
    }

    .card {
      background: #1e1e2e;
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      border: 1px solid #2a2a3e;
    }

    .logo {
      font-size: 48px;
      text-align: center;
      margin-bottom: 16px;
    }

    h1 {
      font-size: 24px;
      text-align: center;
      margin-bottom: 24px;
      color: #fff;
    }

    h2 {
      font-size: 16px;
      margin-bottom: 12px;
      color: #a0a0b0;
    }

    .section {
      margin-bottom: 24px;
      padding-bottom: 24px;
      border-bottom: 1px solid #2a2a3e;
    }

    .section:last-of-type {
      border-bottom: none;
      margin-bottom: 0;
      padding-bottom: 0;
    }

    .status-connected, .status-disconnected {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }

    .status-dot.connected {
      background: #4ade80;
      box-shadow: 0 0 8px #4ade80;
    }

    .status-dot.disconnected {
      background: #6b7280;
    }

    .connected-at {
      font-size: 12px;
      color: #6b7280;
      margin-top: 4px;
    }

    code {
      background: #2a2a3e;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: 'Monaco', 'Consolas', monospace;
    }

    .hint {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 12px;
    }

    .hint a {
      color: #60a5fa;
      text-decoration: none;
    }

    .hint a:hover {
      text-decoration: underline;
    }

    input[type="password"] {
      width: 100%;
      padding: 12px 16px;
      border: 1px solid #3a3a4e;
      border-radius: 8px;
      background: #2a2a3e;
      color: #fff;
      font-size: 14px;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }

    input[type="password"]:focus {
      outline: none;
      border-color: #60a5fa;
    }

    input[type="password"]::placeholder {
      color: #6b7280;
    }

    button {
      width: 100%;
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    button[type="submit"], #submit-btn {
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: #fff;
    }

    button[type="submit"]:hover:not(:disabled) {
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      transform: translateY(-1px);
    }

    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .btn-danger {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: #fff;
    }

    .btn-danger:hover:not(:disabled) {
      background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
    }

    .error-message {
      background: #3b1219;
      border: 1px solid #7f1d1d;
      color: #fca5a5;
      padding: 12px 16px;
      border-radius: 8px;
      margin-top: 16px;
      font-size: 14px;
    }

    .success-message {
      background: #052e16;
      border: 1px solid #166534;
      color: #86efac;
      padding: 12px 16px;
      border-radius: 8px;
      margin-top: 16px;
      font-size: 14px;
    }

    .error-icon {
      font-size: 48px;
      text-align: center;
      margin-bottom: 16px;
    }

    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
    }

    .footer p {
      margin-bottom: 4px;
    }

    .loading {
      text-align: center;
      padding: 32px 0;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #2a2a3e;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 16px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    `;
  }
}
