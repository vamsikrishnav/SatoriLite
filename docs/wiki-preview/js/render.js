function renderSite(config) {
  // Nav
  document.querySelector('.nav-logo').textContent = config.name;
  document.querySelector('.nav-logo').href = 'index.html';
  const navLinksEl = document.querySelector('.nav-links');
  navLinksEl.innerHTML = config.navLinks.map(l =>
    `<li><a href="${l.href}">${l.label}</a></li>`
  ).join('');
  const githubLink = document.querySelector('.nav-github');
  if (config.githubUrl) {
    githubLink.href = config.githubUrl;
  }

  // Hero
  document.querySelector('.hero-title').textContent = config.title;
  document.querySelector('.hero-subtitle').textContent = config.tagline;
  const statsEl = document.querySelector('.hero-stats');
  statsEl.innerHTML = config.stats.map(s => `
    <div class="hero-stat">
      <div class="hero-stat-number">${s.number}</div>
      <div class="hero-stat-label">${s.label}</div>
    </div>
  `).join('');

  // Features
  const featuresGrid = document.querySelector('.features-grid');
  featuresGrid.innerHTML = config.features.map((f, i) => `
    <div class="glass-card animate-in animate-in-delay-${(i % 5) + 1}">
      <div class="feature-icon feature-icon--${f.color}">${f.icon}</div>
      <h3 class="feature-title">${f.title}</h3>
      <p class="feature-desc">${f.desc}</p>
    </div>
  `).join('');

  // Architecture
  const arch = config.architecture;
  document.querySelector('#architecture .section-header p').textContent = arch.subtitle;
  const diagramEl = document.querySelector('.arch-diagram');
  let diagramHtml = '';
  arch.layers.forEach((layer, li) => {
    diagramHtml += `<div class="arch-layer"><div class="arch-layer-label">${layer.label}</div>`;
    layer.rows.forEach(row => {
      diagramHtml += '<div class="arch-row">';
      row.forEach(box => {
        const cls = ['arch-box', `arch-box--${box.style}`, box.full ? 'arch-box--full' : ''].filter(Boolean).join(' ');
        diagramHtml += `<div class="${cls}"><div class="arch-box-title">${box.title}</div><div class="arch-box-sub">${box.sub}</div></div>`;
      });
      diagramHtml += '</div>';
    });
    diagramHtml += '</div>';
    if (li < arch.layers.length - 1) {
      diagramHtml += '<div class="arch-arrows"><div class="arch-arrow-col"><div class="arch-arrow"></div></div></div>';
    }
  });
  diagramHtml += '<div class="arch-legend">';
  arch.legend.forEach(l => {
    diagramHtml += `<div class="arch-legend-item"><span class="arch-legend-swatch arch-legend-swatch--${l.color}"></span>${l.label}</div>`;
  });
  diagramHtml += '</div>';
  diagramEl.innerHTML = diagramHtml;

  // Setup
  const setupSection = document.querySelector('#setup');
  setupSection.querySelector('.section-header p').textContent = config.setup.subtitle;
  const setupGrid = setupSection.querySelector('.setup-grid');
  setupGrid.innerHTML = config.setup.cards.map((card, i) => `
    <div class="setup-card animate-in animate-in-delay-${i + 1}">
      <div class="setup-card-header">
        <h3>${card.title}</h3>
        <span class="badge" style="background: ${card.badge.bg}; color: ${card.badge.color};">${card.badge.text}</span>
      </div>
      <div class="setup-card-body">
        <div class="code-block"><code>${escapeAndHighlight(card.code)}</code></div>
      </div>
    </div>
  `).join('');

  // Footer
  document.querySelector('.footer p').innerHTML = `${config.name} &mdash; ${config.footerText}`;

  // Theme overrides
  if (config.theme) {
    const root = document.documentElement.style;
    if (config.theme.bg) root.setProperty('--bg', config.theme.bg);
    if (config.theme.bgDeep) root.setProperty('--bg-deep', config.theme.bgDeep);
    if (config.theme.surface) root.setProperty('--surface', config.theme.surface);
    if (config.theme.coral) root.setProperty('--coral', config.theme.coral);
    if (config.theme.salmon) root.setProperty('--salmon', config.theme.salmon);
    if (config.theme.cream) root.setProperty('--cream', config.theme.cream);
    if (config.theme.mauve) root.setProperty('--mauve', config.theme.mauve);
    if (config.theme.green) root.setProperty('--green', config.theme.green);
    if (config.theme.purple) root.setProperty('--purple', config.theme.purple);
    if (config.theme.teal) root.setProperty('--teal', config.theme.teal);
  }
}

function escapeAndHighlight(code) {
  return code
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^(#.*)$/gm, '<span class="comment">$1</span>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<span class="string">$1</span>')
    .replace(/\n/g, '\n');
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof SITE_CONFIG !== 'undefined') {
    renderSite(SITE_CONFIG);
  }
});
