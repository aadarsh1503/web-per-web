import { useEffect, useState } from 'react';
import { getAccounts, addAccount, deleteAccount, preparePhoneLogin, activateAccount, switchAccount } from './api';
import './App.css';

const STATUS_COLORS = {
  active: '#10b981',
  available: '#3b82f6',
  cooldown: '#f59e0b',
  needs_auth: '#ef4444',
};

const STATUS_LABELS = {
  active: '🟢 Active',
  available: '🔵 Available',
  cooldown: '🟡 Cooldown',
  needs_auth: '🔴 Needs Login',
};

export default function App() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', usageLimit: 100 });
  const [error, setError] = useState('');
  const [loginModal, setLoginModal] = useState(null); // account being logged in

  const fetchAccounts = async () => {
    try {
      const { data } = await getAccounts();
      setAccounts(Array.isArray(data) ? data : []);
    } catch {
      setError('Failed to load accounts. Check backend URL.');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
    const interval = setInterval(fetchAccounts, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await addAccount(form);
      setForm({ email: '', password: '', usageLimit: 100 });
      setShowAdd(false);
      fetchAccounts();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to add account');
    }
  };

  const handleLogin = async (account) => {
    setActionLoading(account._id + '_login');
    setError('');
    try {
      const { data } = await preparePhoneLogin(account._id);
      const backendUrl = import.meta.env.VITE_API_URL
        ? import.meta.env.VITE_API_URL.replace(/\/api$/, '')
        : `http://${window.location.hostname}:5000`;
      const formUrl = `${backendUrl}/api/phone-login/form/${data.token}`;
      window.open(formUrl, '_blank');
      setLoginModal(account);

      // Listen for postMessage from success page
      const onMsg = (e) => {
        if (e.data === 'mm_login_done') {
          window.removeEventListener('message', onMsg);
          clearInterval(poll);
          setLoginModal(null);
          setActionLoading(null);
          fetchAccounts();
        }
      };
      window.addEventListener('message', onMsg);

      const prevLoginAt = account.lastLoginAt;
      const poll = setInterval(async () => {
        try {
          const { data: accounts } = await getAccounts();
          const updated = accounts.find(a => a._id === account._id);
          if (updated?.lastLoginAt && updated.lastLoginAt !== prevLoginAt) {
            clearInterval(poll);
            window.removeEventListener('message', onMsg);
            setLoginModal(null);
            setActionLoading(null);
            fetchAccounts();
          }
        } catch { /* ignore */ }
      }, 3000);
      setTimeout(() => { clearInterval(poll); window.removeEventListener('message', onMsg); setActionLoading(null); setLoginModal(null); }, 10 * 60 * 1000);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
      setActionLoading(null);
    }
  };

  const handleActivate = async (id) => {
    setActionLoading(id + '_activate');
    try {
      await activateAccount(id);
      fetchAccounts();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this account?')) return;
    await deleteAccount(id);
    fetchAccounts();
  };

  const handleSwitch = async () => {
    setActionLoading('switch');
    try {
      await switchAccount('manual');
      fetchAccounts();
    } catch (err) {
      setError(err.response?.data?.error || 'No available accounts');
    } finally {
      setActionLoading(null);
    }
  };

  const activeAccount = accounts.find((a) => a.status === 'active');

  return (
    <div className="app">
      {/* Top Nav */}
      <nav className="topnav">
        <div className="topnav-left">
          <img src="https://moothmaro.com/static/images/only-logo.png" alt="" height={28} />
          <span className="nav-title">Moothmaro</span>
        </div>
        <div className="topnav-right">
          <button className="icon-btn" onClick={fetchAccounts} title="Refresh">⟳</button>
          <button className="icon-btn switch-btn" onClick={handleSwitch} disabled={actionLoading === 'switch'} title="Switch Account">
            {actionLoading === 'switch' ? '…' : '⇄'}
          </button>
        </div>
      </nav>

      <div className="content">
        {error && (
          <div className="toast error">
            <span>{error}</span>
            <button onClick={() => setError('')}>✕</button>
          </div>
        )}

        {/* Active Account Hero */}
        {activeAccount ? (
          <div className="hero-card">
            <div className="hero-top">
              <div className="hero-dot" />
              <span className="hero-label">Active Account</span>
            </div>
            <div className="hero-email">{activeAccount.email}</div>
            <div className="hero-usage">
              <div className="usage-track">
                <div
                  className="usage-fill"
                  style={{ width: `${Math.min((activeAccount.usageCount / activeAccount.usageLimit) * 100, 100)}%` }}
                />
              </div>
              <span className="usage-text">{activeAccount.usageCount} / {activeAccount.usageLimit} uses</span>
            </div>
          </div>
        ) : (
          <div className="hero-card inactive">
            <div className="hero-label">No Active Account</div>
            <div className="hero-sub">Add an account and login to get started</div>
          </div>
        )}

        {/* Stats Row */}
        <div className="stats-row">
          <div className="stat-pill">
            <span className="sp-num">{accounts.length}</span>
            <span className="sp-label">Total</span>
          </div>
          <div className="stat-pill green">
            <span className="sp-num">{accounts.filter(a => a.status === 'available').length}</span>
            <span className="sp-label">Available</span>
          </div>
          <div className="stat-pill yellow">
            <span className="sp-num">{accounts.filter(a => a.status === 'cooldown').length}</span>
            <span className="sp-label">Cooldown</span>
          </div>
          <div className="stat-pill red">
            <span className="sp-num">{accounts.filter(a => a.status === 'needs_auth').length}</span>
            <span className="sp-label">Need Login</span>
          </div>
        </div>

        {/* Account List */}
        <div className="section-header">
          <span className="section-title">Accounts</span>
          <button className="add-btn" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? '✕ Cancel' : '+ Add'}
          </button>
        </div>

        {showAdd && (
          <form className="add-form" onSubmit={handleAdd}>
            <input
              type="email"
              placeholder="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
            <input
              type="password"
              placeholder="Password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
            <input
              type="number"
              placeholder="Usage Limit (default 100)"
              value={form.usageLimit}
              min={1}
              onChange={(e) => setForm({ ...form, usageLimit: +e.target.value })}
            />
            <button type="submit" className="btn-primary full">Save Account</button>
          </form>
        )}

        {loading ? (
          <div className="loader">
            <div className="spinner" />
            <span>Loading...</span>
          </div>
        ) : accounts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div className="empty-text">No accounts yet</div>
            <div className="empty-sub">Tap "+ Add" to add your first Moothmaro account</div>
          </div>
        ) : (
          <div className="account-list">
            {accounts.map((acc) => (
              <div key={acc._id} className={`acc-card ${acc.status}`}>
                <div className="acc-row">
                  <div className="acc-info">
                    <div className="acc-email">{acc.email}</div>
                    <div className="acc-status" style={{ color: STATUS_COLORS[acc.status] }}>
                      {STATUS_LABELS[acc.status]}
                    </div>
                  </div>
                  <button className="del-btn" onClick={() => handleDelete(acc._id)}>🗑</button>
                </div>

                <div className="acc-meta">
                  <span className="meta-chip">{acc.usageCount}/{acc.usageLimit} uses</span>
                  <span className="meta-chip">{acc.sessionCookiesEncrypted ? '✅ Session' : '❌ No session'}</span>
                  {acc.lastLoginAt && (
                    <span className="meta-chip">🕐 {new Date(acc.lastLoginAt).toLocaleDateString()}</span>
                  )}
                </div>

                {acc.status === 'cooldown' && acc.cooldownUntil && (
                  <div className="cooldown-info">
                    ⏳ Available at {new Date(acc.cooldownUntil).toLocaleString()}
                  </div>
                )}

                {acc.switchHistory?.length > 0 && (
                  <div className="last-switch">
                    Last: {acc.switchHistory.at(-1).reason} · {new Date(acc.switchHistory.at(-1).switchedAt).toLocaleDateString()}
                  </div>
                )}

                <div className="acc-actions">
                  <button
                    className="action-btn login-btn"
                    onClick={() => handleLogin(acc)}
                    disabled={actionLoading === acc._id + '_login'}
                  >
                    {actionLoading === acc._id + '_login' ? '⏳ Opening...' : '🔑 Login'}
                  </button>
                  {acc.status !== 'active' && acc.sessionCookiesEncrypted && (
                    <button
                      className="action-btn activate-btn"
                      onClick={() => handleActivate(acc._id)}
                      disabled={actionLoading === acc._id + '_activate'}
                    >
                      {actionLoading === acc._id + '_activate' ? '...' : '▶ Activate'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Login In-Progress Modal */}
      {loginModal && actionLoading === loginModal._id + '_login' && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div className="modal-spinner" />
            <div className="modal-title">Opening Browser on PC</div>
            <div className="modal-email">{loginModal.email}</div>
            <div className="modal-steps">
              <div className="step done">✅ Login page opened in new tab</div>
              <div className="step active">⏳ Solve reCAPTCHA on that page...</div>
              <div className="step">✅ Tap Login — session saves automatically</div>
              <div className="step">✅ This screen updates when done</div>
            </div>
            <button className="btn-outline-sm" onClick={() => { setLoginModal(null); setActionLoading(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bottom-bar">
        Auto-refresh · Encrypted · {accounts.length} accounts
      </div>
    </div>
  );
}
