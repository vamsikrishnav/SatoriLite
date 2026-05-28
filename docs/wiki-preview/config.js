const SITE_CONFIG = {
  // ─── Identity ───
  name: 'satori~lite',
  title: 'SatoriLite',
  tagline: 'An offline-first markdown wiki that reads and writes real files on your disk. No server, no build step, no lock-in.',
  footerText: 'Offline-First Markdown Wiki — No Server, No Build, No Lock-in',
  githubUrl: 'https://github.com/your-org/satori-lite',

  // ─── Hero Stats (up to 4) ───
  stats: [
    { number: '0ms', label: 'Server Latency' },
    { number: 'PWA', label: 'Offline First' },
    { number: '.md', label: 'Real Files' },
  ],

  // ─── Navigation Links ───
  navLinks: [
    { label: 'Features', href: '#features' },
    { label: 'Architecture', href: '#architecture' },
    { label: 'Setup', href: '#setup' },
  ],

  // ─── Features Grid ───
  features: [
    { icon: '⚡', color: 'coral', title: 'Real Filesystem', desc: 'File System Access API — reads and writes real .md files. Git-friendly, accessible by any editor or tool.' },
    { icon: '📄', color: 'mauve', title: 'CodeMirror 6 Editor', desc: 'Full syntax highlighting, keyboard shortcuts, vim mode, and live markdown preview in a split pane.' },
    { icon: '🌐', color: 'green', title: 'Offline PWA', desc: 'Service Worker caches everything. Works without network. Install it like a native app.' },
    { icon: '🔗', color: 'purple', title: 'Link Autocomplete', desc: 'Type [ and get fuzzy file search. Build a connected knowledge graph with zero friction.' },
    { icon: '📂', color: 'teal', title: 'File Tree', desc: 'Browse, rename, move, and delete files directly from the sidebar. Full file operations without leaving the app.' },
    { icon: '🎨', color: 'salmon', title: 'Catppuccin Themes', desc: 'Tokyo Night dark and Latte light themes. Satori\'s polished visual design, zero-config.' },
  ],

  // ─── Architecture Diagram ───
  architecture: {
    subtitle: 'Vanilla JS, no build step, real files on disk',
    layers: [
      {
        label: 'BROWSER',
        rows: [[{ title: 'Chrome / Edge / Arc / Brave', sub: 'File System Access API | Service Worker | PWA Shell', style: 'surface', full: true }]],
      },
      {
        label: 'APPLICATION',
        rows: [[
          { title: 'Editor', sub: 'CodeMirror 6 | Split Pane', style: 'blue' },
          { title: 'File Manager', sub: 'Tree | Rename | Move | Delete', style: 'green' },
          { title: 'Renderer', sub: 'marked.js | Mermaid | KaTeX', style: 'purple' },
        ]],
      },
      {
        label: 'STORAGE',
        rows: [[{ title: 'Local Filesystem (via File System Access API)', sub: 'Real .md files | Git-compatible | No proprietary format', style: 'infra', full: true }]],
      },
    ],
    legend: [
      { label: 'Editor', color: 'blue' },
      { label: 'File Ops', color: 'green' },
      { label: 'Rendering', color: 'purple' },
    ],
  },

  // ─── Setup Cards ───
  setup: {
    subtitle: 'Open a file and start writing — literally',
    cards: [
      {
        title: 'Local',
        badge: { text: 'Recommended', bg: 'rgba(123,198,123,0.12)', color: '#a0d8a0' },
        code: `# Clone and open\ngit clone https://github.com/you/satori-lite\ncd satori-lite\nopen index.html\n\n# Or serve locally\npython3 -m http.server 8080`,
      },
      {
        title: 'GitHub Pages',
        badge: { text: 'Hosted', bg: 'rgba(155,123,198,0.12)', color: '#c0a8e0' },
        code: `# Push to GitHub, enable Pages\ngit push origin main\n\n# Settings → Pages → Source: main / root\n# Your wiki is live at:\nhttps://you.github.io/satori-lite`,
      },
    ],
  },

  // ─── Theme Overrides (optional — defaults to the purple/coral palette) ───
  // Uncomment and change to customize colors:
  // theme: {
  //   bg: '#3d3552',
  //   bgDeep: '#322b45',
  //   surface: '#4a4060',
  //   coral: '#c66b6b',
  //   salmon: '#d4937e',
  //   cream: '#f0e6dc',
  //   mauve: '#8b7390',
  //   green: '#7bc67b',
  //   purple: '#9b7bc6',
  //   teal: '#6bb8b8',
  // },
};
