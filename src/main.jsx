import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const TABS = [
  { id: 'dashboard', label: 'Главный экран' },
  { id: 'workspace', label: 'Рабочее пространство' },
  { id: 'inventory', label: 'Учет склада' },
  { id: 'transfer', label: 'Заявка на перемещение' },
  { id: 'revision', label: 'Ревизия' },
  { id: 'account', label: 'Личный кабинет' },
  { id: 'tasks', label: 'Сборочное задание' },
];
const ADMIN_LOGIN = 'Admin1';
const ADMIN_PASSWORD = 'Admin123';

function Login({ onLogin }) {
  const [login, setLogin] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState('');
  function submit(event) {
    event.preventDefault();
    if (login === ADMIN_LOGIN && password === ADMIN_PASSWORD) {
      sessionStorage.setItem('b-fbs-auth', 'admin');
      onLogin();
    } else setError('Неверный логин или пароль');
  }
  return <main className="login-page"><section className="login-card">
    <div className="login-mark">B</div><div className="eyebrow">B-FBS</div><h1>Вход в систему</h1>
    <p className="login-description">Складская рабочая система</p>
    <form onSubmit={submit} className="login-form">
      <label>Логин<input value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" /></label>
      <label>Пароль<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      {error && <div className="login-error">{error}</div>}
      <button className="primary-button" type="submit">Войти</button>
    </form>
  </section></main>;
}

function App() {
  const [authenticated, setAuthenticated] = React.useState(() => sessionStorage.getItem('b-fbs-auth') === 'admin');
  const [activeId, setActiveId] = React.useState('dashboard');
  const activeTab = TABS.find((tab) => tab.id === activeId) ?? TABS[0];
  if (!authenticated) return <Login onLogin={() => setAuthenticated(true)} />;
  function logout() { sessionStorage.removeItem('b-fbs-auth'); setAuthenticated(false); }
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">B</div><div><div className="brand-name">B-FBS</div><div className="brand-subtitle">Складская система</div></div></div>
      <nav className="navigation" aria-label="Основная навигация">
        {TABS.map((tab, index) => <button key={tab.id} className={`nav-item ${activeId === tab.id ? 'active' : ''}`} onClick={() => setActiveId(tab.id)}><span className="nav-index">{String(index + 1).padStart(2, '0')}</span><span>{tab.label}</span></button>)}
      </nav>
      <div className="sidebar-footer"><span className="status-dot" />Система готова</div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div><div className="eyebrow">B-FBS / РАБОЧАЯ СРЕДА</div><h1>{activeTab.label}</h1></div><div className="user-controls"><div className="user-badge"><span className="avatar">A</span><span>Admin1</span></div><button className="logout-button" onClick={logout}>Выйти</button></div></header>
      <section className="content-area"><div className="empty-state"><div className="empty-icon">{String(TABS.findIndex((tab) => tab.id === activeId) + 1).padStart(2, '0')}</div><h2>{activeTab.label}</h2><p>Раздел подготовлен. Функциональность будет добавляться поэтапно.</p></div></section>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
