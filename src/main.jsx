import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const tabs = [
  'Главный экран',
  'Рабочее пространство',
  'Учет склада',
  'Заявка на перемещение',
  'Ревизия',
  'Личный кабинет',
  'Сборочное задание',
];

function App() {
  const [activeTab, setActiveTab] = React.useState(tabs[0]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">B</div>
          <div>
            <div className="brand-name">B-FBS</div>
            <div className="brand-subtitle">Складская система</div>
          </div>
        </div>

        <nav className="navigation" aria-label="Основная навигация">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              className={`nav-item ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
              <span>{tab}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          Система готова
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО</div>
            <h1>{activeTab}</h1>
          </div>
          <div className="user-badge">
            <span className="avatar">A</span>
            <span>Admin1</span>
          </div>
        </header>

        <section className="content-area">
          <div className="empty-state">
            <div className="empty-icon">{activeTab === tabs[0] ? '01' : '—'}</div>
            <h2>{activeTab === tabs[0] ? 'Главный экран' : activeTab}</h2>
            <p>Раздел подготовлен. Функциональность будет добавляться поэтапно.</p>
          </div>
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
