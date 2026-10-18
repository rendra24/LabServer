// Ikon lokal: tidak perlu font ikon atau akses jaringan.
const paths = {
  link: ['M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2','M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2'],
  docker: ['M3 9h3v3H3zM7 9h3v3H7zM11 9h3v3h-3zM7 5h3v3H7zM11 5h3v3h-3zM11 1h3v3h-3zM2 13h15c2 0 3-1 4-3 2 4 0 5-3 5-1 4-4 7-9 7-5 0-7-3-7-9z'],
  services: ['M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01M11 7h6M11 17h6'],
  logs: ['M5 3h14v18H5zM8 7h8M8 11h8M8 15h5'],
  play: ['M7 4l13 8-13 8z'],
  stop: ['M5 5h14v14H5z'],
  globe: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', 'M2 12h20M12 2a18 18 0 0 1 0 20 18 18 0 0 1 0-20'],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M7 7h.01M7 17h.01', 'M11 7h6M11 17h6'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M21 21l-4.3-4.3', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  arrow: ['M5 12h14M14 7l5 5-5 5'],
  key: ['M14 5a5 5 0 1 1-3 9l-7 7H1v-3l7-7a5 5 0 0 1 6-6', 'M16 8h.01'],
  lock: ['M5 10h14v11H5z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v3'],
  shield: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  code: ['M8 6l-6 6 6 6M16 6l6 6-6 6M14 3l-4 18'],
  help: ['M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3', 'M12 17h.01', 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  terminal: ['M4 4h16v16H4z', 'M7 8l4 4-4 4M13 16h4'],
  close: ['M6 6l12 12M6 18L18 6'],
  list: ['M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01'],
  edit: ['M16 3l5 5-12 12H4v-5z', 'M14 5l5 5'],
  trash: ['M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7'],
  pulse: ['M2 12h5l3-8 4 16 3-8h5'],
  sun: ['M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8', 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5'],
  moon: ['M20.5 13A9 9 0 0 1 11 3.5a9 9 0 1 0 9.5 9.5'],
  sidebar: ['M3 4h18v16H3z', 'M9 4v16'],
  fullscreen: ['M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5'],
  folder: ['M3 5h7l2 3h9v12H3z'],
  file: ['M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6'],
  'folder-plus': ['M3 5h7l2 3h9v12H3zM12 11v6M9 14h6'],
  laptop: ['M4 3h16v13H4zM2 20l2-4h16l2 4z'],
  upload: ['M12 16V3M7 8l5-5 5 5M4 15v6h16v-6'],
  download: ['M12 3v13M7 11l5 5 5-5M4 16v5h16v-5'],
  up: ['M12 20V4M6 10l6-6 6 6'],
  refresh: ['M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 4M4 15l2 4a7 7 0 0 0 12-2'],
  info: ['M12 10v7M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
  transfer: ['M3 7h17M16 3l4 4-4 4M21 17H4M8 13l-4 4 4 4'],
};

export function icon(name, cls = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [k, value] of Object.entries({ viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.65", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", class: cls })) svg.setAttribute(k, value);
  for (const d of paths[name] || paths.server) {
    const p = document.createElementNS(svg.namespaceURI, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export function decorateIcons() {
  document.querySelectorAll("[data-icon]").forEach((node) => node.prepend(icon(node.dataset.icon)));
}
